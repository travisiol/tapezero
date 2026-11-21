import { useEffect, useState } from 'react';

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useLocation() {
  const [loc, setLoc] = useState({ path: location.pathname, search: location.search });
  useEffect(() => {
    const f = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener('popstate', f);
    return () => window.removeEventListener('popstate', f);
  }, []);
  return loc;
}

export function Link({ to, className, children, ...rest }: { to: string; className?: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
        window.scrollTo(0, 0);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
