import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import { Badge } from "@/components/ui/badge";

export function LevelBadge({ level }: { level: EventLevel }) {
  return (
    <Badge variant={level === "secondary" ? "default" : "outline"}>
      {level === "secondary" ? "Secondary" : "Elementary"}
    </Badge>
  );
}

export function LanguageBadge({ language }: { language: EventLanguage }) {
  const filipino = language === "filipino";
  return (
    <Badge
      variant="outline"
      className={
        filipino
          ? "border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning"
          : "border-primary/40 bg-primary/10 text-primary"
      }
    >
      {filipino ? "Filipino" : "English"}
    </Badge>
  );
}
