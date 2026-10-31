import { FileCodeIcon, LayersIcon, ShieldIcon, SparkIcon } from "@/components/icons";

export const CAPABILITY_STYLES = [
  {
    Icon: ShieldIcon,
    iconBox: "border-lime-300/20 bg-lime-300/10 text-lime-300",
    glow: "bg-lime-400/[0.08]",
    bar: "from-lime-300 to-emerald-400",
  },
  {
    Icon: FileCodeIcon,
    iconBox: "border-cyan-300/20 bg-cyan-300/10 text-cyan-300",
    glow: "bg-cyan-400/[0.08]",
    bar: "from-cyan-300 to-sky-400",
  },
  {
    Icon: LayersIcon,
    iconBox: "border-violet-300/20 bg-violet-300/10 text-violet-300",
    glow: "bg-violet-400/[0.08]",
    bar: "from-violet-300 to-fuchsia-400",
  },
  {
    Icon: SparkIcon,
    iconBox: "border-amber-300/20 bg-amber-300/10 text-amber-300",
    glow: "bg-amber-400/[0.08]",
    bar: "from-amber-300 to-orange-400",
  },
] as const;
