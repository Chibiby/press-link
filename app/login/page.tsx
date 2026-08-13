import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const supabase = await createClient();

  const [{ data: districts }, { data: schools }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Press Link</h1>
        <p className="text-sm text-gray-500">Division Schools Press Conference entry portal</p>
      </div>
      <LoginForm districts={districts ?? []} schools={schools ?? []} />
    </main>
  );
}
