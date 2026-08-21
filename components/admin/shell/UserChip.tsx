import { UserRound } from "lucide-react";

/**
 * The comp's account chip, with the role it actually has. `admin_profiles` carries one
 * flat role, so the comp's "Super Administrator" would be a tier this system does not
 * have — see §4.1 of the spec.
 */
export function UserChip({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 border-l pl-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <UserRound className="size-4" />
      </span>
      <div className="hidden min-w-0 leading-tight sm:block">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className="text-[11px] text-muted-foreground">Division Admin</p>
      </div>
    </div>
  );
}
