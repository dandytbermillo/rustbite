import Link from "next/link";

export default function Home() {
  const storeName = process.env.NEXT_PUBLIC_STORE_NAME ?? "Rushbite";
  const storeLocation = process.env.NEXT_PUBLIC_STORE_LOCATION ?? "";

  const tiles = [
    { href: "/kiosk", label: "Kiosk", sub: "Customer ordering flow", color: "#D7261E", fg: "white" },
    { href: "/counter", label: "Counter", sub: "Cash collection station", color: "#2F6B35", fg: "white" },
    { href: "/kitchen", label: "Kitchen", sub: "KDS — staff order view", color: "#141414", fg: "#FFBE0B" },
    { href: "/board", label: "Wallboard", sub: "Customer pickup display", color: "#FFBE0B", fg: "#141414" },
    { href: "/admin", label: "Admin", sub: "Menu + orders (password)", color: "#FFF8E7", fg: "#141414" },
  ];

  return (
    <main style={{ background: "#FFF8E7", color: "#141414", minHeight: "100vh" }} className="flex flex-col items-center justify-center p-8">
      <div className="display text-5xl md:text-7xl mb-2">{storeName.toUpperCase()}</div>
      <div className="text-sm font-black tracking-widest opacity-60 mb-10">
        {storeLocation} · DEV LANDING
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-5xl">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="btn-press tile-hover rounded-2xl p-8 block"
            style={{ background: t.color, color: t.fg, boxShadow: "0 6px 0 rgba(0,0,0,0.15)" }}
          >
            <div className="display text-3xl">{t.label.toUpperCase()}</div>
            <div className="text-sm font-bold mt-1 opacity-90">{t.sub}</div>
            <div className="text-xs font-black tracking-widest mt-4 opacity-70">{t.href}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
