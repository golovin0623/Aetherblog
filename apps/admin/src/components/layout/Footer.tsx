import { useSiteBranding } from '@/hooks/useSiteBranding';

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { siteName } = useSiteBranding();

  return (
    <footer className="py-4 px-6 border-t border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-center text-[var(--ink-muted)] text-sm">
      <p>© {currentYear} {siteName}. All rights reserved.</p>
    </footer>
  );
}

export default Footer;
