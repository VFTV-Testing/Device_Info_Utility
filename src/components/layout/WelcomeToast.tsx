import { Hand, X } from "lucide-react";
import { toast } from "sonner";
import type { Welcome } from "../../services/welcome";

/** The slim one-line greeting shown once after sign-in (rendered inside the top-right "welcome" Toaster). */
export function WelcomeToast({ id, welcome }: { id: string | number; welcome: Welcome }) {
  return (
    <div className="welcome-card" role="status">
      <span className="welcome-card__icon" aria-hidden>
        <Hand className="welcome-card__wave size-3.5" strokeWidth={2.4} />
      </span>
      <p className="welcome-card__title">
        Welcome, <b>{welcome.name}</b>
      </p>
      <button type="button" className="welcome-card__close" aria-label="Close welcome message" onClick={() => toast.dismiss(id)}>
        <X className="size-3.5" strokeWidth={2.6} aria-hidden />
      </button>
    </div>
  );
}

export function showWelcome(welcome: Welcome) {
  toast.custom((id) => <WelcomeToast id={id} welcome={welcome} />, { toasterId: "welcome", duration: 3000 });
}
