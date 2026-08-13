import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";
import { AuthShell } from "@/components/auth-shell";
import { Wordmark } from "@/components/brand/wordmark";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

export default async function LoginPage() {
  const supabase = await createClient();

  // Only id/name/district_id — never school_id_number, which is the password.
  const [{ data: districts }, { data: schools }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
  ]);

  return (
    <AuthShell>
      <Card className="shadow-lg">
        <CardHeader>
          <Wordmark size="lg" subtitle="Division Schools Press Conference" />
        </CardHeader>
        <CardContent>
          <LoginForm districts={districts ?? []} schools={schools ?? []} />
        </CardContent>
        <CardFooter className="justify-center border-t pt-6">
          <Link
            href="/admin/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Division admin sign-in &rarr;
          </Link>
        </CardFooter>
      </Card>
    </AuthShell>
  );
}
