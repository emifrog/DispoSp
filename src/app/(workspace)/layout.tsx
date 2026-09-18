import { AppProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) { return <AppProvider><Shell>{children}</Shell></AppProvider>; }
