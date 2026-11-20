// @ts-nocheck
// 로그인하지 않은 방문자에게 보여 주는 서비스 소개 홈 화면.
// 내용은 아래 LANDING 객체만 고치면 된다. 스타일은 landing.css(.lp- 접두사)에만 있다.
import './landing.css';

export const LANDING = {
  "icon": "🖼️",
  "name": "이미지 스튜디오",
  "tagline": "사진 해상도 높이기 · 크기 조절 · 용량 줄이기",
  "intro": "사진을 올리면 AI로 선명하게 키우거나, 원하는 크기로 바꾸거나, 화질은 지키면서 용량을 줄여 줘요.",
  "access": "회원가입 후 관리자 승인을 받으면 사용할 수 있어요.",
  "features": [
    {
      "icon": "✨",
      "title": "AI 업스케일",
      "desc": "작거나 흐린 사진을 AI로 2배·4배 선명하게 키워요."
    },
    {
      "icon": "📐",
      "title": "크기 조절",
      "desc": "가로·세로 픽셀이나 비율을 정해 원하는 크기로 바꿔요."
    },
    {
      "icon": "🗜️",
      "title": "용량 줄이기",
      "desc": "JPG·PNG·WebP로 압축해 업로드하기 좋은 용량으로 만들어요."
    },
    {
      "icon": "🕘",
      "title": "작업 기록",
      "desc": "지난 작업과 결과 파일을 기록에서 다시 내려받을 수 있어요."
    }
  ],
  "steps": [
    "회원가입하고 관리자 승인을 기다려요.",
    "원하는 도구를 고르고 사진을 올려요.",
    "처리가 끝나면 결과를 비교해 보고 내려받아요."
  ]
};

export default function Landing({ LinkComponent, loginHref = '/login', signupHref = '/signup' }) {
  const L = LinkComponent ?? ((p) => <a href={p.to} className={p.className}>{p.children}</a>);
  const d = LANDING;
  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-icon" aria-hidden="true">{d.icon}</div>
        <h1 className="lp-title">{d.name}</h1>
        <p className="lp-tagline">{d.tagline}</p>
        {d.intro && <p className="lp-intro">{d.intro}</p>}
        <div className="lp-cta">
          <L to={loginHref} className="lp-btn lp-btn-primary">로그인</L>
          {signupHref && <L to={signupHref} className="lp-btn">{d.signupLabel ?? '회원가입'}</L>}
        </div>
        {d.access && <p className="lp-access">{d.access}</p>}
      </section>

      <section className="lp-section">
        <h2 className="lp-h2">이런 걸 할 수 있어요</h2>
        <ul className="lp-features">
          {d.features.map((f) => (
            <li key={f.title} className="lp-feature">
              <span className="lp-feature-icon" aria-hidden="true">{f.icon}</span>
              <div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {d.steps?.length > 0 && (
        <section className="lp-section">
          <h2 className="lp-h2">사용 방법</h2>
          <ol className="lp-steps">
            {d.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </section>
      )}

      <footer className="lp-footer">
        <a href="https://multi-tools.hotgarlic.dedyn.io">다른 프로젝트 둘러보기 →</a>
      </footer>
    </div>
  );
}
