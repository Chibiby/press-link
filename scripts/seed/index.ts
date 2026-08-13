import { seedEvents } from "./events";
import { seedDistrictsAndSchools } from "./districts-schools";
import { seedSchoolAuthUsers } from "./auth-users";
import { seedAdminUser } from "./admin";

async function main() {
  await seedEvents();
  await seedDistrictsAndSchools();
  await seedSchoolAuthUsers();
  await seedAdminUser();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
