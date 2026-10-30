import { HomeSession } from "@/components/HomeSession";
import { Landing } from "@/components/Landing";

// No cookies and no database. Anonymous visitors can be served this from the edge.
export const dynamic = "force-static";

export default function HomePage() {
  return (
    <HomeSession>
      <Landing />
    </HomeSession>
  );
}
