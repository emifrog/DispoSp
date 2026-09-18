import { Flame } from "lucide-react";
export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Flame size={31} strokeWidth={2.3} />
      </div>
      <div>
        <span className="brand-name">
          DISPO<span>SP</span>
        </span>
        <span className="brand-subtitle">PRÉSENTS, ENSEMBLE.</span>
      </div>
    </div>
  );
}
