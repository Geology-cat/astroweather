interface Props {
  /** 太陽と月の黄経差（0=新月, 180=満月） */
  phaseAngle: number;
  size?: number;
}

/**
 * 月相アイコン。北半球の見え方（満ちていく月は右側が光る）で描く。
 * 明暗境界線は楕円で近似し、その横半径は r·|cos(位相角)|。
 */
export function MoonIcon({ phaseAngle, size = 56 }: Props) {
  const r = 24;
  const c = 28;
  const lam = ((phaseAngle % 360) + 360) % 360;
  const waxing = lam < 180;
  const k = (1 - Math.cos((lam * Math.PI) / 180)) / 2; // 輝面比
  const rx = r * Math.abs(Math.cos((lam * Math.PI) / 180));
  // 右半分を上→下に描き、明暗境界で下→上に戻る（満ちる月の場合）
  const gibbous = k > 0.5;
  const d = `M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} A ${rx} ${r} 0 0 ${gibbous ? 1 : 0} ${c} ${c - r} Z`;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-label={`月相 輝面比${Math.round(k * 100)}%`} role="img">
      <defs>
        <radialGradient id="moonLit" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#f4f5ee" />
          <stop offset="100%" stopColor="#c9ccc4" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={r} fill="#1e2333" />
      <path d={d} fill="url(#moonLit)" transform={waxing ? undefined : `translate(56 0) scale(-1 1)`} />
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.12)" />
    </svg>
  );
}
