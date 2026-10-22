import { AdminOnlyGate } from "@/components/admin/admin-only-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminOnlyGate>{children}</AdminOnlyGate>;
}
