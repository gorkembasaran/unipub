import Link from "next/link";
import { ArrowLeft, Moon, Sun } from "lucide-react";
import UnipubLogo from "@/app/components/UnipubLogo";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";

type AuthorPageTopbarProps = {
  backHref: string;
  backLabel: string;
  brandName: string;
  brandSubtitle: string;
  theme: string;
  themeToggleLabel: string;
  onToggleTheme: () => void;
};

export function AuthorPageTopbar({
  backHref,
  backLabel,
  brandName,
  brandSubtitle,
  theme,
  themeToggleLabel,
  onToggleTheme,
}: AuthorPageTopbarProps) {
  return (
    <header className="authors-topbar">
      <div className="authors-topbar-left">
        <Link href={backHref} className="authors-back" aria-label={backLabel}>
          <ArrowLeft size={18} />
        </Link>
        <div className="authors-brand">
          <div className="authors-brand-icon">
            <UnipubLogo size={30} showText={false} variant="minimal" />
          </div>
          <div>
            <div className="authors-brand-title">{brandName}</div>
            <div className="authors-brand-sub">{brandSubtitle}</div>
          </div>
        </div>
      </div>
      <div className="authors-topbar-actions">
        <LanguageSwitcher triggerClassName="home-lang-trigger authors-lang-trigger" />
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label={themeToggleLabel}
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>
    </header>
  );
}
