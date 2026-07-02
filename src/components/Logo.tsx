import { ShoppingBag } from 'lucide-react';

/**
 * Marketoos wordmark — reproduces the brand logo (shopping-bag "M" tile +
 * "Market" in blue / "oos" in turquoise, Poppins) so it stays crisp at any
 * size and works on light or dark surfaces. The square PNG at
 * /logo/download.png is used for the favicon / app icon instead.
 */
export function Logo({
  onDark = false,
  size = 'md',
}: {
  onDark?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tile =
    size === 'lg' ? 'w-11 h-11 rounded-2xl' : size === 'sm' ? 'w-8 h-8 rounded-lg' : 'w-9 h-9 rounded-xl';
  const icon = size === 'lg' ? 'w-5 h-5' : 'w-[1.15rem] h-[1.15rem]';
  const text = size === 'lg' ? 'text-xl' : 'text-lg';

  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={`${tile} bg-brand-gradient grid place-items-center shadow-glowSm shrink-0`}
      >
        <ShoppingBag className={`${icon} text-white`} strokeWidth={2.4} />
      </span>
      <span className={`font-display font-extrabold ${text} tracking-tight leading-none`}>
        <span className={onDark ? 'text-white' : 'text-brand-700'}>Market</span>
        <span className={onDark ? 'text-teal-300' : 'text-teal-500'}>oos</span>
      </span>
    </span>
  );
}
