export type LookKind = "footwear" | "apparel" | "headwear" | "fit";

export type Look = {
  id: string;
  name: string;
  kind: LookKind;
  image: string;
  line: string;
  whisper: string;
  focus?: string;
  tone?: "light" | "dark";
  index: string;
};

/** Unreleased looks — tap for the reveal, never a PDP. */
export const LOOKS: Look[] = [
  {
    id: "utility-fit",
    name: "Utility Layer",
    kind: "fit",
    image: "/looks/14-utility-fit.png",
    focus: "center 28%",
    tone: "light",
    index: "01",
    line: "Not for sale. For the record.",
    whisper: "We’re building the room before we invite the crowd.",
  },
  {
    id: "sole-signal",
    name: "Sole Signal",
    kind: "footwear",
    image: "/looks/01-sole-signal.png",
    focus: "center center",
    tone: "dark",
    index: "02",
    line: "This sole hasn’t touched Lesotho yet.",
    whisper: "When it does, you’ll hear it before you see it.",
  },
  {
    id: "colorblock-shell",
    name: "Colorblock Shell",
    kind: "apparel",
    image: "/looks/11-colorblock-shell.png",
    focus: "center center",
    tone: "light",
    index: "03",
    line: "The silhouette is finished. The drop isn’t.",
    whisper: "Patience is the only accessory we sell today.",
  },
  {
    id: "pulse-jacket",
    name: "Pulse Varsity",
    kind: "apparel",
    image: "/looks/08-pulse-jacket.png",
    focus: "center center",
    tone: "dark",
    index: "04",
    line: "Letterman energy. Still under lock.",
    whisper: "We don’t rush royalty. We release it.",
  },
  {
    id: "tiger-tee",
    name: "Tiger Signal",
    kind: "apparel",
    image: "/looks/12-tiger-tee.png",
    focus: "center 35%",
    tone: "light",
    index: "05",
    line: "The print is loud. The launch is quieter.",
    whisper: "Coming soon — claws first, copy later.",
  },
  {
    id: "ridge-boot",
    name: "Ridge Boot",
    kind: "footwear",
    image: "/looks/06-ridge-boot.png",
    focus: "center center",
    tone: "light",
    index: "06",
    line: "Altitude first. Availability second.",
    whisper: "The mountain is patient. So are we.",
  },
  {
    id: "varsity-denim",
    name: "Varsity Denim",
    kind: "apparel",
    image: "/looks/16-varsity-denim.png",
    focus: "center center",
    tone: "light",
    index: "07",
    line: "Denim with a diploma. Not enrolled yet.",
    whisper: "Hold the frame. The standard is loading.",
  },
  {
    id: "shadow-hoodie",
    name: "Shadow Hood",
    kind: "apparel",
    image: "/looks/02-shadow-hoodie.png",
    focus: "center 40%",
    tone: "dark",
    index: "08",
    line: "Black that doesn’t apologize.",
    whisper: "We’re finishing the dark so it arrives clean.",
  },
];
