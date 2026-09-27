type Channel = {
  href: string;
  label: string;
  icon: "x" | "github" | "linkedin" | "mail";
};

const channels: Channel[] = [
  { href: "https://x.com/Chinaharryb23", label: "X", icon: "x" },
  { href: "https://github.com/ChinaHarry23", label: "GitHub", icon: "github" },
  {
    href: "https://www.linkedin.com/in/xinlong-bao-52066a343/",
    label: "LinkedIn",
    icon: "linkedin",
  },
  { href: "mailto:xbao0618@uni.sydney.edu.au", label: "xbao0618@uni.sydney.edu.au", icon: "mail" },
  { href: "mailto:hhwbxl1314@gmail.com", label: "hhwbxl1314@gmail.com", icon: "mail" },
];

function ChannelIcon({ name }: { name: Channel["icon"] }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true as const,
  };
  if (name === "x") {
    return (
      <svg {...common}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    );
  }
  if (name === "github") {
    return (
      <svg {...common}>
        <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.79 8.21 11.37.6.11.82-.26.82-.58 0-.28-.01-1.03-.02-2.02-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
      </svg>
    );
  }
  if (name === "linkedin") {
    return (
      <svg {...common}>
        <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.59 0 4.26 2.36 4.26 5.44v6.3zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.73V1.73C24 .77 23.21 0 22.23 0z" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 7 9-7" />
    </svg>
  );
}

export function DeveloperContact() {
  return (
    <footer className="dev-contact">
      <p className="dev-contact-kicker">Contact the developer</p>
      <p className="dev-contact-name">Xinlong Bao</p>
      <ul className="dev-contact-list">
        {channels.map((channel) => {
          const external = channel.href.startsWith("http");
          return (
            <li key={channel.href}>
              <a
                href={channel.href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <ChannelIcon name={channel.icon} />
                {channel.label}
              </a>
            </li>
          );
        })}
      </ul>
    </footer>
  );
}
