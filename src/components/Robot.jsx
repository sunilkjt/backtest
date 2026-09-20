export default function Robot({ mood = 'NEUTRAL' }) {
  const mouth = mood === 'BUY'
    ? 'M30 78 Q50 92 70 78'
    : mood === 'SELL' ? 'M30 84 Q50 70 70 84' : 'M34 80 L66 80';
  const cheek = mood === 'BUY' ? '#34d399' : mood === 'SELL' ? '#fb7185' : '#a78bfa';
  return (
    <svg className="robot" viewBox="0 0 100 112" role="img" aria-label="AI trading robot">
      {/* antenna */}
      <line x1="50" y1="12" x2="50" y2="24" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round" />
      <circle className="antenna-light" cx="50" cy="8" r="6" fill="#f472b6" />
      {/* ears */}
      <rect x="8" y="44" width="10" height="22" rx="5" fill="#22d3ee" />
      <rect x="82" y="44" width="10" height="22" rx="5" fill="#22d3ee" />
      {/* head */}
      <rect x="16" y="24" width="68" height="62" rx="20" fill="#141c3f" stroke="#22d3ee" strokeWidth="3" />
      <rect x="16" y="24" width="68" height="62" rx="20" fill="url(#g)" opacity="0.25" />
      {/* visor */}
      <rect x="24" y="38" width="52" height="30" rx="14" fill="#0b1026" stroke="#a78bfa" strokeWidth="2" />
      <circle className="eye" cx="38" cy="53" r="7" fill="#22d3ee" />
      <circle className="eye" cx="62" cy="53" r="7" fill="#22d3ee" />
      <circle cx="40" cy="55" r="2.4" fill="#fff" />
      <circle cx="64" cy="55" r="2.4" fill="#fff" />
      {/* mouth */}
      <path d={mouth} stroke={cheek} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <circle cx="30" cy="66" r="4" fill={cheek} opacity="0.5" />
      <circle cx="70" cy="66" r="4" fill={cheek} opacity="0.5" />
      {/* body */}
      <rect x="30" y="88" width="40" height="18" rx="9" fill="#1e2a5e" stroke="#f472b6" strokeWidth="2" />
      <circle cx="50" cy="97" r="4" fill="#a3e635" />
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
    </svg>
  );
}
