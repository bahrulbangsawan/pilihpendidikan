import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@rulisme/ui/ui/combobox"
import { Input } from "@rulisme/ui/ui/input"
import { Label } from "@rulisme/ui/ui/label"
import { useCallback, useEffect, useMemo, useState } from "react"
import { countries } from "@/data/countries"
import type { WilayahEntry } from "@/data/wilayah"
import { loadProvinceData } from "@/data/wilayah"
import { provinces as provinceList } from "@/data/wilayah/provinces"
import { useTranslation } from "@/i18n"

interface AddressValues {
  city: string
  kecamatan: string
  state: string
  postalCode: string
  country: string
}

interface AddressFieldsProps {
  values: AddressValues
  onChange: (updates: Partial<AddressValues>) => void
  stateLabel?: string
  cityPlaceholder?: string
  statePlaceholder?: string
}

// Stable references for items arrays (avoid re-creating on each render)
const countriesArray = [...countries]
const provincesArray = provinceList.map((p) => p.nama)

export function AddressFields({
  values,
  onChange,
  stateLabel,
  cityPlaceholder,
  statePlaceholder,
}: AddressFieldsProps) {
  const { t } = useTranslation()
  const isIndonesia = values.country === "Indonesia"
  const [kabupatenList, setKabupatenList] = useState<Array<WilayahEntry>>([])
  const [allKecamatanList, setAllKecamatanList] = useState<Array<WilayahEntry>>(
    []
  )
  const [loadingKab, setLoadingKab] = useState(false)

  // Find the selected province code from the province name
  const selectedProvince = provinceList.find((p) => p.nama === values.state)

  // Find the selected kabupaten entry from the kabupaten name
  const selectedKabupaten = kabupatenList.find((k) => k.nama === values.city)

  // Filter kecamatan by selected kabupaten code prefix
  const kecamatanList = useMemo(() => {
    if (!selectedKabupaten) {
      return []
    }
    const prefix = selectedKabupaten.kode + "."
    return allKecamatanList.filter((k) => k.kode.startsWith(prefix))
  }, [selectedKabupaten, allKecamatanList])

  // Stable string arrays for Combobox items prop
  const kabupatenNames = useMemo(
    () => kabupatenList.map((k) => k.nama),
    [kabupatenList]
  )
  const kecamatanNames = useMemo(
    () => kecamatanList.map((k) => k.nama),
    [kecamatanList]
  )

  // Load kabupaten + kecamatan when province changes
  useEffect(() => {
    if (!(isIndonesia && selectedProvince)) {
      setKabupatenList([])
      setAllKecamatanList([])
      return
    }

    let cancelled = false
    setLoadingKab(true)

    loadProvinceData(selectedProvince.kode).then((data) => {
      if (!cancelled) {
        setKabupatenList(data.kabupaten)
        setAllKecamatanList(data.kecamatan)
        setLoadingKab(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isIndonesia, selectedProvince?.kode])

  const handleCountryChange = useCallback(
    (value: string | null) => {
      const newCountry = value ?? ""
      if (newCountry !== values.country) {
        onChange({
          country: newCountry,
          state: "",
          city: "",
          kecamatan: "",
          postalCode: "",
        })
      }
    },
    [values.country, onChange]
  )

  const handleProvinceChange = useCallback(
    (value: string | null) => {
      const newState = value ?? ""
      if (newState !== values.state) {
        onChange({
          state: newState,
          city: "",
          kecamatan: "",
          postalCode: "",
        })
      }
    },
    [values.state, onChange]
  )

  const handleKabupatenChange = useCallback(
    (value: string | null) => {
      const newCity = value ?? ""
      if (newCity !== values.city) {
        onChange({
          city: newCity,
          kecamatan: "",
          postalCode: "",
        })
      }
    },
    [values.city, onChange]
  )

  const handleKecamatanChange = useCallback(
    (value: string | null) => {
      onChange({ kecamatan: value ?? "" })
    },
    [onChange]
  )

  return (
    <div
      className={
        isIndonesia
          ? "grid grid-cols-2 gap-3 lg:grid-cols-5"
          : "grid grid-cols-2 gap-3 lg:grid-cols-4"
      }
    >
      {/* Country */}
      <div className="space-y-1.5">
        <Label>{t("form.country")}</Label>
        <Combobox
          autoComplete="one-time-code"
          items={countriesArray}
          onValueChange={handleCountryChange}
          value={values.country || null}
        >
          <ComboboxInput
            className="w-full"
            placeholder={t("placeholders.searchCountry")}
          />
          <ComboboxContent>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>{t("placeholders.noResults")}</ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
      </div>

      {/* State/Region (Province for Indonesia) */}
      <div className="space-y-1.5">
        <Label>{stateLabel ?? t("form.stateRegion")}</Label>
        {isIndonesia ? (
          <Combobox
            autoComplete="one-time-code"
            items={provincesArray}
            onValueChange={handleProvinceChange}
            value={values.state || null}
          >
            <ComboboxInput
              className="w-full"
              placeholder={t("placeholders.searchProvince")}
            />
            <ComboboxContent>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
              <ComboboxEmpty>{t("placeholders.noResults")}</ComboboxEmpty>
            </ComboboxContent>
          </Combobox>
        ) : (
          <Input
            autoComplete="one-time-code"
            onChange={(e) => onChange({ state: e.target.value })}
            placeholder={statePlaceholder}
            value={values.state}
          />
        )}
      </div>

      {/* City (Kabupaten/Kota for Indonesia) */}
      <div className="space-y-1.5">
        <Label>{t("form.city")}</Label>
        {isIndonesia ? (
          <Combobox
            autoComplete="one-time-code"
            items={kabupatenNames}
            onValueChange={handleKabupatenChange}
            value={values.city || null}
          >
            <ComboboxInput
              className="w-full"
              disabled={!selectedProvince || loadingKab}
              placeholder={
                selectedProvince
                  ? loadingKab
                    ? t("placeholders.loading")
                    : t("placeholders.searchKabupaten")
                  : t("placeholders.selectProvinceFirst")
              }
            />
            <ComboboxContent>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
              <ComboboxEmpty>{t("placeholders.noResults")}</ComboboxEmpty>
            </ComboboxContent>
          </Combobox>
        ) : (
          <Input
            autoComplete="one-time-code"
            onChange={(e) => onChange({ city: e.target.value })}
            placeholder={cityPlaceholder}
            value={values.city}
          />
        )}
      </div>

      {/* Kecamatan (Indonesia only) */}
      {isIndonesia && (
        <div className="space-y-1.5">
          <Label>{t("form.kecamatan")}</Label>
          <Combobox
            autoComplete="one-time-code"
            items={kecamatanNames}
            onValueChange={handleKecamatanChange}
            value={values.kecamatan || null}
          >
            <ComboboxInput
              className="w-full"
              disabled={!selectedKabupaten}
              placeholder={
                selectedProvince
                  ? selectedKabupaten
                    ? t("placeholders.searchKecamatan")
                    : t("placeholders.selectKabupatenFirst")
                  : t("placeholders.selectProvinceFirst")
              }
            />
            <ComboboxContent>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
              <ComboboxEmpty>{t("placeholders.noResults")}</ComboboxEmpty>
            </ComboboxContent>
          </Combobox>
        </div>
      )}

      {/* Postal Code */}
      <div className="space-y-1.5">
        <Label>{t("form.postalCode")}</Label>
        <Input
          autoComplete="one-time-code"
          onChange={(e) => onChange({ postalCode: e.target.value })}
          placeholder={t("placeholders.postalCode")}
          value={values.postalCode}
        />
      </div>
    </div>
  )
}
