"use client";

import { useId, useRef } from "react";
import { Search, X } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";

/**
 * The free-text box in an admin filter bar, shaped like `FilterSelect` so the two
 * sit in the same grid without either knowing about the other: same label above,
 * same 32px control, same `rounded-lg border-input` shell, same `dark:bg-input/30`.
 * None of that is restated here — `InputGroup` and `SelectTrigger` already agree,
 * and the moment this file starts overriding heights they stop.
 *
 * Built on `InputGroup` rather than an icon absolutely positioned over an `Input`,
 * which is what `app/entry/ListToolbar.tsx` still does: the addon carries its own
 * padding, so nothing has to hand-count the input's left inset, and it focuses the
 * input when clicked. `components/ui/command.tsx` builds its search box the same
 * way.
 *
 * The state above this is what makes it feel instant. `useFilterParams` keeps the
 * value in local state and debounces only the URL write, so nothing here waits on
 * a server render; this component is controlled and has no timing of its own.
 */
export function FilterSearch({
  label,
  value,
  onChange,
  placeholder,
}: {
  /**
   * The visible label, and the input's accessible name through `htmlFor`. No
   * `aria-label` alongside it: an `aria-label` would override the label a sighted
   * reader can see, so the two could drift apart with nothing to catch it. The
   * clear button is the one control here that needs a name of its own.
   */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          ref={inputRef}
          // A search input, so a phone offers a "search" key and assistive tech
          // announces it as one. The rest of this is deliberate: these lists are
          // Filipino surnames, which autocorrect fights.
          type="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // WebKit's own clear button is suppressed in favour of the one below.
          // It only exists in Chromium and Safari, it cannot be reached from the
          // keyboard, it has no accessible name, and with no `color-scheme` set
          // on this app it stays a dark glyph in dark mode. Leaving it would also
          // put two crosses in the box in Chrome.
          className="[&::-webkit-search-cancel-button]:hidden"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {value !== "" && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              // Named for what it clears, because a bar can hold several of these
              // and "Clear" alone would be ambiguous in a list of landmarks.
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => {
                onChange("");
                // Clearing removes this button from the page, which would leave
                // a keyboard reader's focus on nothing. Hand it to the box they
                // were about to retype into.
                inputRef.current?.focus();
              }}
            >
              {/* 14px in a 24px button. The `size-4` the button would otherwise
                  give it crowds the corners. */}
              <X className="size-3.5" />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  );
}
