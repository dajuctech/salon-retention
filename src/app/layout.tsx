import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// NFR-P1/P3: text never waits for the web font. "optional" paints at once with the system font
// on a slow first visit and uses Geist once it's cached.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "optional",
});

export const metadata: Metadata = {
  title: "Salon Retention & Booking",
  description: "Bookings, reminders and win-back for barbing salons.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
    >
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before
          hydration. This only silences mismatches on <body>'s own attributes, not its children. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
