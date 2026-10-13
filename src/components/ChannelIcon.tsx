import { Globe, Mail, Monitor, Printer } from "lucide-react";
import { FaInstagram } from "react-icons/fa6";
import type { Channel } from "@/lib/types";

const icons: Record<Channel, React.ComponentType<{ size?: number; className?: string }>> = {
  instagram: FaInstagram,
  web: Globe,
  email: Mail,
  print: Printer,
  digital_signage: Monitor,
};

/** The icon for a channel, so lists read at a glance without the label. */
export function ChannelIcon({ channel, size = 16, className }: { channel: Channel; size?: number; className?: string }) {
  const Icon = icons[channel];
  return <Icon size={size} className={className} />;
}
