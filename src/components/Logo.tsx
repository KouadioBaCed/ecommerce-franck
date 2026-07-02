/**
 * Marketoos wordmark — official bag/"M" icon (/logo/marketoos_flaticon.png)
 * next to the "Market" (blue) / "oos" (turquoise) wordmark in Poppins.
 * Works on light or dark surfaces. The full square logo (download.png) is used
 * for the favicon / app icon.
 */
export function Logo({
  onDark = false,
  size = 'md',
}: {
  onDark?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const icon = size === 'lg' ? 'w-11 h-11' : size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  const text = size === 'lg' ? 'text-xl' : 'text-lg';

  return (
    <span className="inline-flex items-center gap-2">
      <img
        src="/logo/marketoos_flaticon.png"
        alt="Marketoos"
        className={`${icon} object-contain shrink-0`}
        draggable={false}
      />
      <span className={`font-display font-extrabold ${text} tracking-tight leading-none`}>
        <span className={onDark ? 'text-white' : 'text-brand-700'}>Market</span>
        <span className={onDark ? 'text-teal-300' : 'text-teal-500'}>oos</span>
      </span>
    </span>
  );
}
