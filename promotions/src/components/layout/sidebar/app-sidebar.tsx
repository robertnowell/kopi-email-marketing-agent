"use client";

import * as React from "react";
import {
  AudioWaveform,
  BookOpen,
  Bot,
  Command,
  GalleryVerticalEnd,
  Palette,
  Settings2,
  SquareTerminal,
  Mail,
  Loader2Icon,
  Gift,
  Lightbulb,
  Pin,
  TrendingUp,
  CalendarDays,
} from "lucide-react";
import { NavProjects } from "./nav-projects";
import { NavUser } from "./nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { Icons } from "@/components/common/icons";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/shared/utils/utils";
import { FeedbackButton } from "@/components/common/feedback/feedback-button";
import { useBrands } from "@/features/editor/properties/brands/brand-hooks";
import {
  BrandSelectorDialog,
  BrandSelectorPopover,
} from "@/features/email-templates/brands/brand-selector-popover";
import { getAuth, onAuthStateChanged } from "firebase/auth";

// This is sample data.
const data = {
  teams: [
    {
      name: "Acme Inc",
      logo: GalleryVerticalEnd,
      plan: "Enterprise",
    },
    {
      name: "Acme Corp.",
      logo: AudioWaveform,
      plan: "Startup",
    },
    {
      name: "Evil Corp.",
      logo: Command,
      plan: "Free",
    },
  ],
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "History",
          url: "#",
        },
        {
          title: "Starred",
          url: "#",
        },
        {
          title: "Settings",
          url: "#",
        },
      ],
    },
    {
      title: "Models",
      url: "#",
      icon: Bot,
      items: [
        {
          title: "Genesis",
          url: "#",
        },
        {
          title: "Explorer",
          url: "#",
        },
        {
          title: "Quantum",
          url: "#",
        },
      ],
    },
    {
      title: "Documentation",
      url: "#",
      icon: BookOpen,
      items: [
        {
          title: "Introduction",
          url: "#",
        },
        {
          title: "Get Started",
          url: "#",
        },
        {
          title: "Tutorials",
          url: "#",
        },
        {
          title: "Changelog",
          url: "#",
        },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        {
          title: "General",
          url: "#",
        },
        {
          title: "Team",
          url: "#",
        },
        {
          title: "Billing",
          url: "#",
        },
        {
          title: "Limits",
          url: "#",
        },
      ],
    },
  ],
  projects: [
    {
      name: "Autopilot",
      url: "/app/agent",
      icon: Bot,
    },
    {
      name: "Ideas",
      url: "/app/ideas",
      icon: Lightbulb,
    },
    {
      name: "Calendar",
      url: "/app/calendar",
      icon: CalendarDays,
    },
    {
      name: "Emails",
      url: "/app/email",
      icon: Mail,
    },
    {
      name: "Inspiration",
      url: "/app/inspiration",
      icon: Pin,
    },
    {
      name: "Images",
      url: "/app/library",
      icon: Palette,
    },
    {
      name: "Klaviyo",
      url: "/app/sunset",
      icon: TrendingUp,
      subItems: [
        { name: "Save Money", url: "/app/sunset" },
        { name: "Flow Performance", url: "/app/flow-performance" },
      ],
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { state } = useSidebar();
  const [mounted, setMounted] = React.useState(false);
  const { currentBrand } = useBrands();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Check if we're in debug mode
  const isDebugMode =
    process.env.NODE_ENV === "development" ||
    (typeof window !== "undefined" && window.location.hostname === "localhost");

  // Hide Klaviyo tab during loading, show for Klaviyo brands and legacy brands (no platform set)
  const showKlaviyo =
    !!currentBrand && (!currentBrand.targetPlatform || currentBrand.targetPlatform === "klaviyo");
  const projects = showKlaviyo
    ? data.projects
    : data.projects.filter((p) => p.name !== "Klaviyo");

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="flex items-start pt-4">
        <Link
          href="/app/email"
          title="brand-logo"
          className="relative flex items-center"
        >
          <Icons.logo className="h-[36px] w-auto" />
          {state === "expanded" && (
            <span className="ml-2 text-xl">
              <span className="font-bold">Kopi</span> AI
            </span>
          )}
        </Link>

        {/* <TeamSwitcher teams={data.teams} /> */}
      </SidebarHeader>
      <SidebarContent>
        {/* <NavMain items={data.navMain} /> */}

        {/* <SidebarSeparator /> */}

        <BrandSection mounted={mounted} />

        {/* <SidebarGroupLabel className="h-auto pt-4">Create</SidebarGroupLabel> */}
        {/* <SidebarSeparator className="my-2" /> */}

        <NavProjects projects={projects} />

        {/* Admin Section - Only show in debug mode */}
        {isDebugMode && (
          <>
            {/* <SidebarSeparator className="my-2" /> */}
            {/* <SidebarGroupLabel className="text-red-600">
              Admin
            </SidebarGroupLabel> */}
            {/* <NavProjects projects={adminProjects} /> */}
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <FeedbackButton />
        <SidebarTrigger className="-ml-1" />
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

const BrandSection = ({ mounted }: { mounted: boolean }) => {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const isAssetsGenerate = pathname?.includes("/assets/generate");
  const [userId, setUserId] = React.useState<string | null>(null);

  // Get user ID
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuth(), (user) => {
      setUserId(user?.uid || null);
    });
    return unsubscribe;
  }, []);

  // Get brand state using new hook
  const { brands, isLoading } = useBrands();

  return (
    <div className="p-2">
      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg bg-[hsl(240_4.8%_95.9%)] p-2 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0",
          isAssetsGenerate && "bg-transparent"
        )}
      >
        <div className="flex items-center justify-between group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="h-auto bg-transparent px-0">
            {!isAssetsGenerate && "Current Brand"}
          </SidebarGroupLabel>
          {!isAssetsGenerate && (
            <Link
              href="/app/brands"
              className="rounded-md border border-border/50 bg-background/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground"
            >
              All Brands
            </Link>
          )}
        </div>
        <div className="flex flex-col">
          {isAssetsGenerate ? (
            <div className="flex h-8 flex-col items-center justify-center" />
          ) : !mounted || isLoading ? (
            <div className="flex h-8 flex-col items-center justify-center">
              <Loader2Icon className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : brands.length > 0 ? (
            isMobile ? (
              <BrandSelectorDialog />
            ) : (
              <BrandSelectorPopover />
            )
          ) : (
            // No brands available
            <div className="flex h-8 flex-col items-center justify-center">
              <span className="text-muted-foreground text-xs">No brands</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
