import SliderRow from "./SliderRow.jsx";

export default function SectionPanel({ section, adjustments, onChange }) {
  return (
    <div className="space-y-3.5 px-1 pb-2">
      {section.defs.map((def) => (
        <SliderRow
          key={def.key}
          def={def}
          value={adjustments[def.key]}
          onChange={onChange}
        />
      ))}
    </div>
  );
}