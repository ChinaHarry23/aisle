import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16">
      <h1 className="font-serif text-4xl">That page isn&apos;t on the floor.</h1>
      <Link href="/" className="mt-4 inline-block text-sm text-signal">
        Back to the desk
      </Link>
    </div>
  );
}
