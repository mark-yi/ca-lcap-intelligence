import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "California LCAP Intelligence",
  description: "Semantic LCAP and Dashboard GTM intelligence for California school districts."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
