import type { Metadata, Viewport } from "next";
import { appUrl } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: "HyperVault — A place to store your AI stuff",
    template: "%s · HyperVault",
  },
  description:
    "Save everything your AI makes to a permanent link — and store your agents' credentials in a password vault built for agents, not autofill.",
  openGraph: {
    title: "HyperVault — A place to store your AI stuff",
    description:
      "Save everything your AI makes to a permanent link — and store your agents' credentials in a password vault built for agents, not autofill.",
    url: appUrl(),
    siteName: "HyperVault",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HyperVault",
    description: "A place to store your AI stuff.",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "HyperVault",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
