// '오늘 함께' — 어제치를 세어 index.html 의 <!--ROLLUP--> 사이를 갈아 끼운다.
//
// 왜 빌드 시점에 숫자를 박는가:
//   가이드 페이지에는 JS 가 한 줄도 없다(scroll reveal 이 본문을 숨겨 버린 사고 뒤로
//   일부러 그렇게 뒀다). 브라우저에서 DB 를 부르면 그 성질이 깨지고, 무료 플랜이
//   정지되면 빈칸이 된다. 하루 한 번 여기서 세어 HTML 에 적어 두면 둘 다 없다.
//   덤으로 이 작업이 매일 DB 를 두드리니 '7일 무활동 정지' 도 안 걸린다.
//
// 어제치를 쓰는 이유: 오늘은 아직 안 끝났다. 반쯤 지난 하루의 인원 수를 보여주면
// 늘 적게 나오고, 늦게 누른 사람은 자기가 빠진 것으로 본다.
//
// ⚠ service_role 키를 쓰지 않는다 (2026-09-14).
//   표를 직접 읽으려면 그 강력한 키를 저장소 비밀에 넣어야 한다. 어차피 사람에게 보여줄
//   것은 숫자뿐이므로, 숫자만 돌려주는 함수(day_counts, security definer)를 공개 키로
//   부른다. 줄 하나하나는 이 키로 여전히 못 읽는다.
//
// 설정이 없으면 아무것도 하지 않고 정상 종료한다 — Supabase 를 아직 안 만들었을 때
// 매일 실패 메일이 오면 안 된다.

import { readFile, writeFile } from 'node:fs/promises';

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
const FILE = 'index.html';
const OPEN = '<!--ROLLUP-->';
const CLOSE = '<!--/ROLLUP-->';
const GRADES = ['★★★', '★★', '★'];

if (!URL_BASE || !KEY) {
  console.log('SUPABASE_URL / SUPABASE_ANON_KEY 가 없습니다 — 건너뜁니다');
  process.exit(0);
}

/** KST 기준 어제. Action 은 UTC 로 도는데 사용자의 하루는 한국 시간이다. */
function yesterdayKST(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @returns {{total:number, filled:number, rested:number, grades:Record<string,number>}} */
async function counts(day) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/day_counts`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', Accept: 'application/json',
    },
    body: JSON.stringify({ p_day: day }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  // 그날 줄이 없으면 함수가 null 을 돌려준다
  return {
    total: Number(d?.total) || 0,
    filled: Number(d?.filled) || 0,
    rested: Number(d?.rested) || 0,
    grades: (d && typeof d.grades === 'object' && d.grades) || {},
  };
}

/** 숫자 칸. 크기를 서로 같게 둔다 — 하나만 크면 그게 점수처럼 읽힌다. */
function card(n, label) {
  return `      <div class="tg__c"><div class="tg__n">${n}</div>`
       + `<div class="tg__k">${esc(label)}</div></div>`;
}

function html(day, c) {
  const total = c.total;
  if (!total) {
    return `    <p class="dimline">${esc(dayLabel(day))}에는 아직 아무도 더하지 않았습니다.</p>`;
  }
  const filled = c.filled;
  const rested = c.rested;
  // 어떤 표시를 셀지는 여기서 정한다 — DB 는 길이만 본다
  const byGrade = GRADES.map((g) => [g, Number(c.grades[g]) || 0]).filter(([, n]) => n > 0);

  // 큰 글씨는 셋만 둔다.
  //   ① 등급을 큰 칸으로 올리면 그게 점수처럼 읽힌다 — 등급은 남과 견줄 것이 아니라
  //      내 하루의 리듬이다. 그래서 작은 줄로 내린다.
  //   ② 칸이 셋이면 한 줄에 딱 맞는다. 등급 수가 날마다 달라 칸 수가 3~6 으로 흔들리면
  //      5+1 처럼 어긋난 줄이 생긴다.
  //
  // 라벨은 짧은 명사구로 맞춘다. '★★★ 을' 처럼 기호 뒤에 조사를 붙이면
  // 을/를 이 정해지지 않아 어느 쪽을 써도 어색하다.
  const cards = [
    card(`${total}명`, '하루를 더한 사람'),
    card(`${filled}명`, '목표를 채운 사람'),
    card(`${rested}명`, '쉬는 날로 남긴 사람'),
  ];
  const grades = byGrade.map(([g, n]) => `${g} ${n}명`).join(' · ');
  return `    <p class="tg__d">${esc(dayLabel(day))} 기준</p>\n`
       + `    <div class="tg">\n${cards.join('\n')}\n    </div>\n`
       + (grades ? `    <p class="dimline tg__g">등급 ${esc(grades)}</p>` : '');
}

function dayLabel(day) {
  const [, m, d] = day.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}

const day = process.env.ROLLUP_DAY || yesterdayKST();
const c = await counts(day);
const block = html(day, c);

const src = await readFile(FILE, 'utf8');
const a = src.indexOf(OPEN);
const b = src.indexOf(CLOSE);
if (a < 0 || b < 0 || b < a) {
  console.error(`${FILE} 에 ${OPEN} 표시가 없습니다 — site/build.py 가 넣습니다`);
  process.exit(1);
}
const out = src.slice(0, a + OPEN.length) + '\n' + block + '\n' + src.slice(b);

if (out === src) {
  console.log(`${day} · ${c.total}명 · 바뀐 것 없음`);
} else {
  await writeFile(FILE, out);
  console.log(`${day} · ${c.total}명 · ${FILE} 갱신`);
}
