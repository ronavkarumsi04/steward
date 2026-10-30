import { Icon } from "@/components/icons";
import s from "./work-order.module.css";

/** The order's signature line: a real form that carries the email into sign-up or sign-in. */
export function EntryForm({ id, action, label, note }: { id: string; action: string; label: string; note: string }) {
  return (
    <form action={action} method="get" className={s.sign}>
      <label htmlFor={id} className={s.fieldLabel}>
        Authorised by
      </label>
      <div className={s.signRow}>
        <input id={id} name="email" type="email" autoComplete="email" required placeholder="you@yourcompany.com" className={s.signInput} aria-describedby={`${id}-note`} />
        <button type="submit" className={s.signButton}>
          {label}
          <Icon.ArrowRight size={18} />
        </button>
      </div>
      <p id={`${id}-note`} className={s.signNote}>
        {note}
      </p>
    </form>
  );
}
