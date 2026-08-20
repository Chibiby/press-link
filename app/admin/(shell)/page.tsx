import { redirect } from "next/navigation";

/**
 * /admin has shown the entries table since this app shipped. Task 15 replaces
 * this file with the overview dashboard; until then, redirecting keeps the URL
 * behaving exactly as admins expect and keeps the sidebar's Dashboard link off
 * a 404.
 */
export default function AdminIndexPage() {
  redirect("/admin/entries");
}
