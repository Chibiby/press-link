"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";

import { remainingLabel } from "@/lib/submissions/revision-grant";
import type { RevisionGrantBanner } from "@/lib/submissions/school-lock";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Where a grant is remembered as seen, keyed by the grant's own id.
 *
 * By id and never by a boolean "seen the revision modal", which is the whole
 * reason `grantId` travels down from `school-lock.ts`: a refresh must not re-nag
 * a school that has already read the notice, and a *second* grant, granted an
 * hour later for something else, must. One flag cannot tell those two apart, and
 * whichever way it was read one of the two schools would be served badly — either
 * nagged on every reload or never told the office had reopened its work again.
 *
 * Nothing is ever cleared. The keys are a few dozen bytes each, a school
 * accumulates one per grant it was actually shown, and pruning them would mean
 * this component knowing which grants are over — which is a question only the
 * database answers.
 */
function ackKey(grantId: string) {
  return `presslink.entry.revision-grant.${grantId}`;
}

/**
 * Whether this grant has already been announced to this browser.
 *
 * Every access is wrapped, both here and in {@link acknowledge}, because reading
 * `localStorage` *throws* rather than returning null in a private window or with
 * site data blocked — touching the property is enough. An unwrapped read would
 * take down the one banner that tells a school its window is open, in the state
 * where it can least afford to miss it. A browser that cannot remember the
 * acknowledgement is shown the modal again on the next load, which is the right
 * failure: mildly annoying beats silently unannounced.
 */
function alreadySeen(grantId: string): boolean {
  try {
    return window.localStorage.getItem(ackKey(grantId)) !== null;
  } catch {
    return false;
  }
}

function acknowledge(grantId: string) {
  try {
    window.localStorage.setItem(ackKey(grantId), "1");
  } catch {
    // Nothing to do and nothing to report: the school's window is unaffected, and
    // the only consequence is that the modal appears again next time.
  }
}

/** How long is left, and whether the window is still open at all. */
interface Countdown {
  label: string;
  open: boolean;
}

const TICK_MS = 1000;

/**
 * The good-news state: the division office reopened part of this school's work,
 * for a while, while the division-wide lock stays on.
 *
 * Two pieces, and they answer different questions. The modal is the announcement
 * — a school that is looking at its roster will not notice a new line of text at
 * the top of the page, and the window is measured in half hours. The banner is
 * the reminder, and it stays for as long as the grant does.
 *
 * **It decides nothing.** Not one control on this page is enabled or disabled
 * from anything computed here: the read-only flags come from the server, from
 * `entrySubmissionLock()`, and behind that the database re-asks
 * `revision_allows()` on every single write. That separation is the point. A
 * school's device clock can be minutes out in either direction, and a browser
 * that decided the window was open would be showing editable forms over a guard
 * refusing every save, while one that decided it was shut would close a window
 * the database would still have honoured. So at zero this asks the server again
 * and does nothing else.
 *
 * That is why it counts down on the **server's** clock and not the device's — see
 * `serverNow` below. Deciding nothing is not on its own enough to be honest: the
 * first version of this ticked from a bare `new Date()`, and on the school laptop
 * whose clock is four minutes fast it printed "This window has closed" while every
 * control was still editable and every save still landed, then stayed that way for
 * the rest of the window — the effect keys on `expiresAt`, so the refresh at zero
 * returned the same unchanged grant and never re-ran it. A school reading that
 * phones the office about a bug that is not there. Running on the instant the
 * server rendered removes the whole class rather than the symptom: the banner and
 * the guard are then talking about the same window.
 */
export function RevisionGrantNotice({
  banner,
  serverNow,
}: {
  banner: RevisionGrantBanner;
  /**
   * The instant the server rendered, ISO — the same `new Date()` `activeGrant()`
   * was resolved against, and therefore within a request of the `now()` the guard
   * uses.
   */
  serverNow: string;
}) {
  const router = useRouter();
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // The refresh at zero fires once. The interval keeps running — it is what
  // renders "this window has closed" until the server render lands — and without
  // this it would ask for a fresh page every second.
  const refreshed = useRef(false);
  // How far this device's clock sits from the server's, in ms, captured once on
  // the first tick and then held. Once, and not per tick, because it is meant to
  // be a fixed correction: re-deriving it from a `serverNow` that only changes on
  // a server render would make it jump on every refresh rather than converge.
  //
  // It also absorbs the transit and hydration time between the server render and
  // this mount, so the displayed clock trails the server by roughly a page load —
  // sub-second in practice, against the *minutes* a wrong device clock is out, and
  // `remainingLabel` rounds to whole minutes anyway. Stated rather than hidden:
  // it errs by showing a shade more time than remains, and the only thing standing
  // on that number is what the sentence says, never what the page permits.
  const clockOffset = useRef<number | null>(null);

  // Announced on mount and not during render, because `localStorage` does not
  // exist on the server: opening the dialog from a `useState` initialiser would
  // render a tree the server never sent and hydration would tear. The cost is one
  // frame without the modal, which nobody perceives.
  useEffect(() => {
    if (alreadySeen(banner.grantId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModalOpen(true);
  }, [banner.grantId]);

  useEffect(() => {
    const expiresAt = new Date(banner.expiresAt).getTime();

    if (clockOffset.current === null) {
      const rendered = Date.parse(serverNow);
      // An unreadable `serverNow` falls back to no correction rather than to
      // `NaN`, which would make every label read "expired" — the device clock is a
      // worse clock, not no clock, and this prop is server-built from a `Date` so
      // the fallback is unreachable in practice.
      clockOffset.current = Number.isNaN(rendered) ? 0 : rendered - Date.now();
    }
    const offset = clockOffset.current;

    function tick() {
      // The server's clock, advanced by the device's ticks. `Date.now()` is only
      // ever used here as a stopwatch — for how much time has passed since mount —
      // and never as an answer to what time it is.
      const now = new Date(Date.now() + offset);
      const next: Countdown = {
        label: remainingLabel(banner.expiresAt, now),
        // Read from the instant rather than by comparing the label against the
        // string "expired": the copy below and the boundary test would then be the
        // same decision written twice, and rewording the label would silently move
        // the boundary.
        open: !Number.isNaN(expiresAt) && now.getTime() < expiresAt,
      };

      // Only when something actually changed. The interval runs every second and
      // the label moves once a minute, and this alert carries `role="alert"`: a
      // re-render that rewrites identical text is a live region firing at some
      // screen readers once a second.
      setCountdown((current) =>
        current && current.label === next.label && current.open === next.open
          ? current
          : next,
      );

      if (!next.open && !refreshed.current) {
        refreshed.current = true;
        // The server re-reads the grant and decides. This does not lock anything,
        // and it must not: see the note on this component.
        router.refresh();
      }
    }

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [banner.expiresAt, serverNow, router]);

  function dismiss() {
    acknowledge(banner.grantId);
    setModalOpen(false);
  }

  // Not a guessed time. 0031 declares `expires_at not null` so this is
  // unreachable, and inventing a clock time for a school that is about to lose
  // unsaved work is the one thing worse than admitting the stamp is missing.
  const expiryLine = banner.expiryLabel
    ? `This window closes at ${banner.expiryLabel}.`
    : "The closing time for this window could not be read.";

  return (
    <>
      {/* The same alert as the frozen banners, so this reads as one system — but a
          clock rather than the padlock or the fail-closed triangle, because this
          is the one state that is not trouble. The border tint is decoration only:
          the icon and the sentence carry every part of the meaning, so a school
          that cannot tell the two borders apart loses nothing. */}
      <Alert className="border-primary/40">
        <Clock />
        <AlertTitle>{banner.title}</AlertTitle>
        <AlertDescription>
          <p>{banner.description}</p>
          <p>
            {expiryLine}{" "}
            {/* Absent on the server and on the first client paint, then filled in
                by the effect above. A countdown rendered straight from
                `new Date()` mismatches by construction — the server's instant and
                the browser's are never the same one — and the fix is not to
                suppress the warning but to have nothing to compare. */}
            {countdown && (
              // `aria-live="off"` inside a `role="alert"` container: the banner
              // announces itself once when it appears, which is right, and the
              // minutes ticking down after that are not each their own
              // interruption.
              <span aria-live="off">
                {countdown.open
                  ? `Time left: ${countdown.label}.`
                  : "This window has closed."}
              </span>
            )}
          </p>
        </AlertDescription>
      </Alert>

      {/* Acknowledged however it is closed — the button, Escape or the X — because
          all three mean the school has seen it, and a modal that only counted the
          button would come back on the next reload for a school that read it and
          pressed Escape. Everything closes through `dismiss()` for that reason:
          `onOpenChange` fires for Radix's own dismissals but not for a `setState`
          of our own, so a button that closed the dialog directly would skip the
          write. */}
      <Dialog open={modalOpen} onOpenChange={(open) => (open ? setModalOpen(true) : dismiss())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{banner.title}</DialogTitle>
            {/* Already names what was reopened *and* what stayed frozen — see
                `grantBanner()`. Repeating it here rather than shortening it: this
                is the one moment the school reads the scope, and a partial grant
                that announced only the good half would be found out by a failed
                save. */}
            <DialogDescription>{banner.description}</DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground">{expiryLine}</p>
          <DialogFooter>
            <Button onClick={dismiss}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
