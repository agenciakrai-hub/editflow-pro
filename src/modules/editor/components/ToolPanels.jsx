import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { SLIDER_SECTIONS } from "../utils/paramDefs.js";
import SectionPanel from "./SectionPanel.jsx";
import ToneCurvePanel from "./ToneCurvePanel.jsx";
import ColorMixerPanel from "./ColorMixerPanel.jsx";
import ColorGradingPanel from "./ColorGradingPanel.jsx";
import CropPanel from "./CropPanel.jsx";

const SPECIAL = [
  { id: "curve", label: "Curva de tonos", component: ToneCurvePanel },
  { id: "hsl", label: "Mezclador de color", component: ColorMixerPanel },
  { id: "grading", label: "Calibración de color", component: ColorGradingPanel },
  { id: "crop", label: "Recortar y enderezar", component: CropPanel },
];

export default function ToolPanels({ adjustments, setAdjustments }) {
  const items = [
    ...SLIDER_SECTIONS.map((s) => ({ ...s, special: null })),
    ...SPECIAL.map((s) => ({ id: s.id, label: s.label, defs: null, special: s.component })),
  ];

  return (
    <Accordion type="multiple" defaultValue={["light"]} className="w-full space-y-2">
      {items.map((sec) => {
        const Special = sec.special;
        return (
          <AccordionItem key={sec.id} value={sec.id} className="bg-card rounded-2xl border border-border px-4">
            <AccordionTrigger className="text-sm font-semibold py-3 hover:no-underline">
              {sec.label}
            </AccordionTrigger>
            <AccordionContent className="pt-2">
              {Special
                ? <Special adjustments={adjustments} setAdjustments={setAdjustments} />
                : <SectionPanel section={sec} adjustments={adjustments} onChange={(k, v) => setAdjustments((prev) => ({ ...prev, [k]: v }))} />}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}