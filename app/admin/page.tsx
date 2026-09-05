import { pageUser } from "../account-server";
import { AdminWorkspace } from "./admin-workspace";
export const dynamic = "force-dynamic";
export default async function AdminPage() { return <AdminWorkspace user={await pageUser(true)} />; }
