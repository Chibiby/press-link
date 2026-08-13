import { AdminLoginForm } from "./AdminLoginForm";

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-center text-2xl font-bold">Press Link Admin</h1>
      <AdminLoginForm />
    </main>
  );
}
