import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CalendarDays,
  Clapperboard,
  FileSearch,
  Gauge,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const steps: { icon: LucideIcon; name: string; does: string; human?: boolean }[] = [
  {
    icon: TrendingUp,
    name: "Trends",
    does: "Reads weather, news and competitor language, then drafts a brief with sources cited.",
  },
  {
    icon: Clapperboard,
    name: "Studio",
    does: "Writes copy and builds ads and videos from your templates, two variants at a time.",
  },
  {
    icon: ShieldCheck,
    name: "Compliance",
    does: "Checks the poster against that market's law index, and sends fixes back.",
  },
  {
    icon: ShieldAlert,
    name: "You approve",
    does: "Anything medium or high risk waits for your sign-off. Nothing ships without it.",
    human: true,
  },
  {
    icon: CalendarDays,
    name: "Schedule",
    does: "Posts to web, social and print, and flags clashes before they happen.",
  },
];

const features: { icon: LucideIcon; title: string; body: string; wide?: boolean }[] = [
  {
    icon: Lock,
    title: "Agents can't publish",
    body: "Every action passes a policy guard first. An attempt to publish, overspend or change a cleared claim is refused and written to the log, so you can see the guard working.",
    wide: true,
  },
  {
    icon: FileSearch,
    title: "Every finding has a source",
    body: "Research cites where it came from. Anything it can't back up is labelled an assumption.",
  },
  {
    icon: Gauge,
    title: "Results feed the next brief",
    body: "Aisle pulls in performance and recommends what to do next. You accept, edit or discard.",
  },
  {
    icon: Sparkles,
    title: "Your brand, your rules",
    body: "Upload guideline documents and set approved and banned terms. Compliance flags breaches before you see them.",
    wide: true,
  },
];

function Mockup() {
  const rows: { label: string; state: string; tone: "done" | "run" | "wait" }[] = [
    { label: "Trends", state: "Brief ready", tone: "done" },
    { label: "Studio", state: "2 variants", tone: "done" },
    { label: "Compliance", state: "v2 passed", tone: "done" },
    { label: "Approval", state: "Awaiting you", tone: "wait" },
  ];
  return (
    <div className="lp-mock lp-rise relative mx-auto w-full max-w-md p-5 [animation-delay:0.15s]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-mute">Campaign</p>
          <p className="font-semibold">Summer BBQ Specials</p>
        </div>
        <span className="status-chip status-wait">Awaiting approval</span>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between rounded-xl bg-paper-2 px-3 py-2.5 text-sm"
          >
            <span className="flex items-center gap-2.5 font-medium">
              <span
                className={
                  r.tone === "done"
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-signal text-white"
                    : "h-5 w-5 animate-pulse rounded-full bg-signal/30 ring-2 ring-signal"
                }
              >
                {r.tone === "done" ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              {r.label}
            </span>
            <span className="text-xs text-mute">{r.state}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-line p-3">
        <div className="flex gap-3">
          <div className="h-16 w-16 shrink-0 rounded-lg bg-gradient-to-br from-[#14a393] via-[#0f766e] to-[#6366f1]" />
          <div className="min-w-0 text-sm">
            <p className="font-medium">Fire up the grill</p>
            <p className="mt-0.5 text-xs leading-snug text-ink-soft">
              Fresh lamb and sausages, all week in store.
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="lp-btn btn-primary !rounded-lg !py-2 !text-[13px]">Approve</span>
          <span className="lp-btn lp-btn-ghost !rounded-lg !py-2 !text-[13px]">Request changes</span>
        </div>
      </div>

      <div className="lp-float absolute -left-4 top-24 hidden items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs font-medium shadow-lg ring-1 ring-line sm:flex lg:-left-12">
        <ShieldCheck size={14} className="text-signal" /> Claim cleared
      </div>
      <div className="lp-float absolute -right-3 bottom-16 hidden items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs font-medium shadow-lg ring-1 ring-line [animation-delay:1.5s] sm:flex lg:-right-10">
        <Lock size={14} className="text-signal" /> Publish blocked
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="lp-nav">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" aria-label="Aisle home">
            <BrandLogo />
          </Link>
          <nav aria-label="Page" className="hidden items-center gap-7 text-sm font-medium text-ink-soft md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#trust" className="hover:text-ink">Why trust us</a>
          </nav>
          <nav aria-label="Account" className="flex items-center gap-1.5">
            <Link href="/login" className="px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink">
              Log in
            </Link>
            <Link href="/signup" className="lp-btn btn-primary !px-4 !py-2 !text-sm">
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-16 md:pb-28 md:pt-24 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="lp-pill lp-rise">
                <Sparkles size={14} /> An AI marketing team for retailers
              </p>
              <h1 className="lp-rise mt-6 text-5xl font-semibold leading-[1.04] tracking-tight [animation-delay:0.05s] md:text-7xl">
                Retail marketing,
                <br />
                <span className="lp-grad-text">done for you.</span>
              </h1>
              <p className="lp-rise mt-6 max-w-xl text-lg leading-relaxed text-ink-soft [animation-delay:0.1s]">
                Tell Aisle what you&apos;re promoting and who it&apos;s for. AI agents spot the trends, write
                the copy, design the visuals, check every claim against your brand, and
                schedule it across your channels. Nothing goes live until you say so.
              </p>
              <div className="lp-rise mt-9 flex flex-wrap items-center gap-3 [animation-delay:0.15s]">
                <Link href="/signup" className="lp-btn btn-primary">
                  Get started free <ArrowRight size={16} />
                </Link>
                <Link href="/login" className="lp-btn lp-btn-ghost">
                  Log in
                </Link>
              </div>
              <ul className="lp-rise mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft [animation-delay:0.2s]">
                {["Human approval on every launch", "Sources cited", "Brand and country rules checked"].map(
                  (t) => (
                    <li key={t} className="flex items-center gap-1.5">
                      <Check size={14} className="text-signal" strokeWidth={2.6} /> {t}
                    </li>
                  ),
                )}
              </ul>
            </div>
            <Mockup />
          </div>
        </section>

        <section aria-label="Built for retail" className="mx-auto max-w-6xl px-6">
          <figure className="relative overflow-hidden rounded-[28px] bg-ink">
            <Image
              src="/landing-page.jpg"
              alt="Two supermarket staff stocking fruit and vegetable displays"
              width={2000}
              height={1096}
              priority
              sizes="(min-width: 1152px) 1104px, 100vw"
              className="h-[22rem] w-full object-cover md:h-[30rem]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
            <figcaption className="absolute inset-x-0 bottom-0 flex flex-col gap-4 p-7 text-white md:flex-row md:items-end md:justify-between md:p-10">
              <p className="max-w-xl text-2xl font-semibold leading-tight tracking-tight md:text-4xl">
                Your team is busy on the shop floor. Let Aisle handle the marketing.
              </p>
              <p className="max-w-xs text-sm leading-relaxed text-white/75">
                Promotions planned, checked and scheduled in the background, while you run the store.
              </p>
            </figcaption>
          </figure>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 md:py-28">
          <p className="text-sm font-semibold uppercase tracking-wider text-signal">How it works</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl">
            From brief to published in five steps.
          </h2>
          <p className="mt-4 max-w-xl text-ink-soft">
            Four agents do the work. You stay in the loop at the one step that matters.
          </p>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map(({ icon: Icon, name, does, human }, i) => (
              <li key={name} className="lp-card flex flex-col gap-4 p-5">
                <div className="flex items-center justify-between">
                  <span
                    className={
                      human
                        ? "flex h-10 w-10 items-center justify-center rounded-xl bg-signal text-white"
                        : "flex h-10 w-10 items-center justify-center rounded-xl bg-signal-soft text-signal"
                    }
                  >
                    <Icon size={19} strokeWidth={1.8} />
                  </span>
                  <span className="text-xs font-medium tabular-nums text-mute">0{i + 1}</span>
                </div>
                <div>
                  <h3 className="font-semibold">{name}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{does}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="trust" className="bg-paper-2 py-20 md:py-28">
          <div className="mx-auto max-w-6xl scroll-mt-20 px-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-signal">Built for trust</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl">
              Move fast without shipping something you regret.
            </h2>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {features.map(({ icon: Icon, title, body, wide }) => (
                <div key={title} className={`lp-card p-7 ${wide ? "md:col-span-2" : ""}`}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-soft text-signal">
                    <Icon size={19} strokeWidth={1.8} />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-soft">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="lp-dark rounded-[28px] px-8 py-14 text-center md:px-16 md:py-20">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl">
              Run your first campaign today.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-white/70">
              Add a product and an audience. The agents handle the rest, and you press approve.
            </p>
            <Link
              href="/signup"
              className="lp-btn mt-8 !bg-white !text-ink hover:!bg-white/90"
            >
              Create your account <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-mute">
          <BrandLogo />
          <p>Nothing goes live until you approve it.</p>
        </div>
      </footer>
    </div>
  );
}
