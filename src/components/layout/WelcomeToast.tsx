import { Hand, X } from "lucide-react";
import { toast } from "sonner";
import type { Welcome } from "../../services/welcome";

const SUBTITLE: Record<Welcome["via"], string> = {
  github: "Signed in with GitHub",
  passkey: "Signed in with the pass key · Moderator",
};

/** The greeting card shown once after sign-in (rendered inside the top-right "welcome" Toaster). */
export function WelcomeToast({ id, welcome }: { id: string | number; welcome: Welcome }) {
  return (
    <div className="welcome-card" role="status">
      <span className="welcome-card__icon" aria-hidden>
        <Hand className="welcome-card__wave size-[18px]" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="welcome-card__title">Welcome, {welcome.name} !!</p>
        <p className="welcome-card__sub">{SUBTITLE[welcome.via]}</p>
      </div>
      <button type="button" className="welcome-card__close" aria-label="Close welcome message" onClick={() => toast.dismiss(id)}>
        <X className="size-4" strokeWidth={2.6} aria-hidden />
      </button>
    </div>
  );
}

export function showWelcome(welcome: Welcome) {
  toast.custom((id) => <WelcomeToast id={id} welcome={welcome} />, { toasterId: "welcome", duration: 3000 });
}
