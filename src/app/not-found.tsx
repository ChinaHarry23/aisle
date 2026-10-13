import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16">
      <h1 className="font-serif text-2xl tracking-tight md:text-3xl">That page isn&apos;t on the floor.</h1>
      <Link href="/" className="mt-4 inline-block text-sm font-medium text-signal hover:underline">
        Back to overview
      </Link>
    </div>
  );
}
