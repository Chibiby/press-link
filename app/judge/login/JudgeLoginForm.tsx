"use client";

import { useState, useTransition } from "react";
import { Gavel, Loader2 } from "lucide-react";

import { judgeLoginAction } from "./actions";
import { PasswordInput } from "@/components/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JudgeLoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await judgeLoginAction(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" name="email" required autoComplete="username" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="judge-password">Password</Label>
        <PasswordInput
          id="judge-password"
          name="password"
          required
          autoComplete="current-password"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in...
          </>
        ) : (
          <>
            <Gavel className="size-4" />
            Sign in
          </>
        )}
      </Button>
    </form>
  );
}
