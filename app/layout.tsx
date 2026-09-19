import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BillProof — local access checks",
  description: "Catch subscription access mismatches before release.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
