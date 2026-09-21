"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "../common";
export const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      danger: "button-danger",
    },
    size: { default: "", sm: "button-sm", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

/**
 * Un bouton qui sait attendre sa propre action.
 *
 * Si son `onClick` rend une promesse — ce que font toutes les commandes — il
 * s'éteint et tourne jusqu'à ce qu'elle se règle. Rien à passer au point
 * d'appel : c'est le bouton cliqué qui montre l'attente, et lui seul. Un
 * indicateur global aurait fait tourner les vingt boutons de l'écran pour un
 * seul geste.
 *
 * `pending` est pour l'autre moitié des cas : un bouton d'envoi ne reçoit pas
 * le clic, c'est le `onSubmit` du formulaire qui travaille. Le formulaire sait
 * qu'il est en cours — il le dit ici.
 *
 * Le `asChild` en est exempté : il ne rend alors pas un bouton mais un lien,
 * qui navigue au lieu d'écrire.
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  onClick,
  disabled,
  pending = false,
  children,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean; pending?: boolean }) {
  const Comp = asChild ? Slot : "button";
  const [clicked, setClicked] = React.useState(false);
  const waiting = clicked || pending;
  // Ne pas toucher à l'état d'un bouton que React a déjà retiré de l'écran :
  // une boîte de dialogue se ferme souvent avant que la promesse se règle.
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handle(event: React.MouseEvent<HTMLButtonElement>) {
    const outcome = onClick?.(event) as unknown;
    if (!(outcome instanceof Promise)) return;
    setClicked(true);
    try {
      await outcome;
    } finally {
      if (mounted.current) setClicked(false);
    }
  }

  if (asChild) {
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        onClick={onClick}
        disabled={disabled}
        {...props}
      >
        {children}
      </Comp>
    );
  }
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={handle}
      disabled={disabled || waiting}
      aria-busy={waiting || undefined}
      {...props}
    >
      {waiting && <Spinner size={15} />}
      {children}
    </Comp>
  );
}
