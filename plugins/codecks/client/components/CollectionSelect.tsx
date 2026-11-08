import { observer } from "mobx-react";
import {
  CollectionIcon as CollectionIconComponent,
  PrivateCollectionIcon,
} from "outline-icons";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import Icon from "@shared/components/Icon";
import { colorPalette } from "@shared/constants";
import useContrastColor from "@shared/hooks/useContrastColor";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import useStores from "~/hooks/useStores";

interface Props {
  /** The ID of the selected collection. */
  value: string | null;
  /** Called with the ID of the chosen collection. */
  onChange: (collectionId: string) => void;
  /** Whether the select is disabled. */
  disabled?: boolean;
}

/**
 * A select listing the team's active collections other than personal ones,
 * which are the collections a Codecks project can be mapped to. The parent is
 * responsible for loading collections.
 */
export const CollectionSelect = observer(function CollectionSelect({
  value,
  onChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const { collections } = useStores();
  const contrastColor = useContrastColor();

  // Resolve icon properties eagerly within this observer to avoid MobX
  // warnings when Radix Select clones the elements for the trigger.
  const options: Option[] = collections.allActive.map((collection) => {
    const color = contrastColor(collection.color ?? colorPalette[0]);
    const collectionIcon = collection.icon;

    let icon: ReactElement;
    if (!collectionIcon || collectionIcon === "collection") {
      const Component = collection.isPrivate
        ? PrivateCollectionIcon
        : CollectionIconComponent;
      icon = <Component color={color} />;
    } else {
      icon = (
        <Icon
          value={collectionIcon}
          color={color}
          initial={collection.initial}
          forceColor
        />
      );
    }

    return {
      type: "item",
      label: collection.displayName,
      value: collection.id,
      icon,
    };
  });

  return (
    <InputSelect
      options={options}
      value={value}
      onChange={onChange}
      label={t("Collection")}
      labelHidden
      disabled={disabled}
    />
  );
});
