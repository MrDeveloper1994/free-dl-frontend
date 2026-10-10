import "./globals.css";

export const metadata = {
  title: "FreeDL Web — دانلودر ویدیو",
  description: "دانلودر سریع و امن ویدیو با yt-dlp + ffmpeg (نسخه وب)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⬇️</text></svg>" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          media="print"
          onLoad="this.media='all'"
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700;900&display=swap"
        />
        <noscript>
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700;900&display=swap"
          />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
