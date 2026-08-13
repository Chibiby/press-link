import Link from "next/link";

import { AdminLoginForm } from "./AdminLoginForm";
import { AuthShell } from "@/components/auth-shell";
import { Wordmark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

export default function AdminLoginPage() {
  return (
    <AuthShell>
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <Wordmark size="lg" subtitle="Division Schools Press Conference" />
            <Badge variant="secondary">Admin</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <AdminLoginForm />
        </CardContent>
        <CardFooter className="justify-center border-t pt-6">
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            &larr; School sign-in
          </Link>
        </CardFooter>
      </Card>
    </AuthShell>
  );
}
