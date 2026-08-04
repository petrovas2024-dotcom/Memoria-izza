"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronLeft, ExternalLink, Home, ImagePlus, MapPin, MessageCircle, Navigation, Save, ShieldAlert, Trash2, Upload, X } from "lucide-react";
import { authenticatedFetch } from "../lib/supabase-browser";

type ClientInfo = { id: number; name: string; phone: string; address: string };
type ServiceInfo = { id: number; folio: string; client: string; type: string; date: string; technician: string; status: string };
type PropertyPhoto = { id: number; category: string; description: string; user_name: string; created_at: string };
type PropertyData = {
  id?: number; name: string; address: string; references: string; neighborhood: string; city: string;
  postalCode: string; latitude: string; longitude: string; mapsUrl: string; notes: string;
};
type PendingPhoto = { file: File; previewUrl: string };

const MAX_PHOTO_SIZE = 12 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 850 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

async function optimizePhoto(file: File) {
  if (file.size <= MAX_UPLOAD_SIZE) return file;
  if (file.type === "image/heic" || file.type === "image/heif") {
    throw new Error(`${file.name}: configura la cámara en formato compatible o usa una imagen HEIC menor de 850 KB`);
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`No se pudo preparar ${file.name}`);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let quality = 0.82;
  let blob: Blob | null = null;
  do {
    blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    quality -= 0.1;
  } while (blob && blob.size > MAX_UPLOAD_SIZE && quality >= 0.42);
  if (!blob || blob.size > MAX_UPLOAD_SIZE) throw new Error(`${file.name}: no se pudo reducir a un tamaño compatible`);
  const basename = file.name.replace(/\.[^.]+$/, "") || "fotografia";
  return new File([blob], `${basename}.jpg`, { type:"image/jpeg", lastModified:file.lastModified });
}

export function PropertyAgendaSummary({ clientId }: { clientId: number }) {
  const [summary, setSummary] = useState<{ photoId?:number; notes?:string } | null>(null);
  useEffect(() => {
    let active = true;
    authenticatedFetch(`/api/properties?clientId=${clientId}`).then(response => response.ok ? response.json() : Promise.reject()).then(data => {
      if (!active || !data.property) return;
      const facade = (data.photos || []).find((photo:PropertyPhoto) => photo.category === "Fachada") || data.photos?.[0];
      setSummary({ photoId:facade?.id, notes:data.property.notes });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [clientId]);
  if (!summary) return null;
  return <span className="agenda-property-summary">{summary.photoId ? <img src={`/api/property-photos?id=${summary.photoId}`} alt="Fachada de la propiedad"/> : <Home/>}<small>{summary.notes ? summary.notes.split("\n")[0] : "Propiedad vinculada"}</small></span>;
}

const categories = ["Fachada","Acceso","Boiler","Tinaco","Bomba","Minisplit","Tablero eléctrico","Patio","Techo","Cocina","Baño","Otra"];

function normalizeProperty(raw: Record<string, unknown> | null, client: ClientInfo): PropertyData {
  return {
    id: raw?.id as number | undefined,
    name: String(raw?.name || "Domicilio principal"),
    address: String(raw?.address || client.address),
    references: String(raw?.references || ""),
    neighborhood: String(raw?.neighborhood || ""),
    city: String(raw?.city || "Tijuana"),
    postalCode: String(raw?.postal_code || ""),
    latitude: String(raw?.latitude || ""),
    longitude: String(raw?.longitude || ""),
    mapsUrl: String(raw?.maps_url || ""),
    notes: String(raw?.notes || ""),
  };
}

export default function PropertyProfile({ client, services, onBack, notify }: { client: ClientInfo; services: ServiceInfo[]; onBack:()=>void; notify:(message:string)=>void }) {
  const [property, setProperty] = useState<PropertyData>(() => normalizeProperty(null, client));
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [category, setCategory] = useState("Fachada");
  const [description, setDescription] = useState("");
  const [lightbox, setLightbox] = useState<PropertyPhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const loadProperty = async () => {
    try {
      const response = await authenticatedFetch(`/api/properties?clientId=${client.id}`);
      if (!response.ok) throw new Error();
      const data = await response.json();
      setProperty(normalizeProperty(data.property, client));
      setPhotos(data.photos || []);
    } catch { notify("No se pudo sincronizar la propiedad"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    authenticatedFetch(`/api/properties?clientId=${client.id}`)
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => {
        if (!active) return;
        setProperty(normalizeProperty(data.property, client));
        setPhotos(data.photos || []);
      })
      .catch(() => { if (active) notify("No se pudo sincronizar la propiedad"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Client records are stable in the parent; reload only when opening another client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  useEffect(() => () => pendingPhotos.forEach(photo => URL.revokeObjectURL(photo.previewUrl)), [pendingPhotos]);

  const mapsQuery = property.latitude && property.longitude ? `${property.latitude},${property.longitude}` : property.address;
  const validMapsUrl = /^https:\/\/(www\.)?(google\.[^/]+\/maps(?:\/|\?|$)|maps\.app\.goo\.gl\/)/i.test(property.mapsUrl) ? property.mapsUrl : "";
  const mapsHref = validMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;
  const mapEmbed = `https://www.google.com/maps?q=${encodeURIComponent(mapsQuery)}&output=embed`;
  const history = useMemo(() => services.filter(service => service.client === client.name), [services, client.name]);

  const persistProperty = async (nextProperty: PropertyData, successMessage?: string) => {
    setSaving(true);
    try {
      const response = await authenticatedFetch("/api/properties", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ...nextProperty, clientId:client.id, clientName:client.name, clientPhone:client.phone }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la propiedad");
      const saved = {...nextProperty, id:Number(data.id)};
      setProperty(saved);
      if (successMessage) notify(successMessage);
      return saved;
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar la propiedad");
      return null;
    } finally {
      setSaving(false);
    }
  };
  const save = () => void persistProperty(property, "Propiedad guardada permanentemente");

  const useCurrentLocation = () => {
    if (!window.isSecureContext) return notify("La ubicación requiere abrir IZZA SMART con HTTPS");
    if (!navigator.geolocation) return notify("Este dispositivo no comparte ubicación");
    navigator.geolocation.getCurrentPosition(position => {
      const next = {...property, latitude:String(position.coords.latitude), longitude:String(position.coords.longitude), mapsUrl:""};
      setProperty(next);
      void persistProperty(next, "Ubicación obtenida y guardada");
    }, error => {
      const messages: Record<number,string> = {
        1:"Permite la ubicación para IZZA SMART en los ajustes del navegador",
        2:"El dispositivo no pudo determinar la ubicación",
        3:"La ubicación tardó demasiado; inténtalo de nuevo al aire libre",
      };
      notify(messages[error.code] || "No se pudo obtener la ubicación");
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:30000 });
  };

  const parseMapsLink = (value: string) => {
    const decoded = (() => { try { return decodeURIComponent(value); } catch { return value; } })();
    const match = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
      || decoded.match(/[?&](?:query|q)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    setProperty(current => ({...current, mapsUrl:value.trim(), ...(match ? {latitude:match[1], longitude:match[2]} : {})}));
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const invalid = selected.find(file => !ALLOWED_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_PHOTO_SIZE);
    if (invalid) return notify(`${invalid.name}: usa JPG, PNG, WEBP o HEIC de hasta 12 MB`);
    const previews = selected.map(file => ({file, previewUrl:URL.createObjectURL(file)}));
    setPendingPhotos(previews);
    setUploading(true);
    try {
      const savedProperty = property.id ? property : await persistProperty(property);
      const propertyId = savedProperty?.id;
      if (!propertyId) throw new Error("Primero guarda una dirección válida");
      for (const originalFile of selected) {
        const file = await optimizePhoto(originalFile);
        const form = new FormData();
        form.append("file", file); form.append("propertyId", String(propertyId)); form.append("category", category); form.append("description", description); form.append("userName", "Iván M.");
        const response = await authenticatedFetch("/api/property-photos", { method:"POST", body:form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `No se pudo subir ${file.name}`);
      }
      setDescription("");
      await loadProperty();
      notify(selected.length === 1 ? "Fotografía guardada" : `${selected.length} fotografías guardadas`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudieron guardar las fotografías");
    } finally {
      previews.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
      setPendingPhotos([]);
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const removePhoto = async (id:number) => {
    const response = await authenticatedFetch(`/api/property-photos?id=${id}`, {method:"DELETE"});
    if (!response.ok) return notify("No se pudo eliminar la fotografía");
    setPhotos(current => current.filter(photo => photo.id !== id)); notify("Fotografía eliminada");
  };

  return <section className="property-profile">
    <div className="property-toolbar"><button className="secondary-button" onClick={onBack}><ChevronLeft size={17}/>Clientes</button><div><p className="eyebrow">EXPEDIENTE DEL CLIENTE</p><h2>{client.name}</h2></div><button className="primary-button" onClick={save} disabled={saving}><Save size={17}/>{saving ? "Guardando..." : "Guardar propiedad"}</button></div>
    <div className="client-tabs"><button>Resumen</button><button className="active"><Home size={16}/>Propiedad</button><button>Documentos</button></div>

    <article className="card property-map-card">
      <div className="property-map"><iframe title="Mapa de la propiedad" src={mapEmbed} loading="lazy" referrerPolicy="no-referrer-when-downgrade"/></div>
      <div className="map-actions">
        <div><span className="map-pin"><MapPin/></span><div><strong>{property.name}</strong><small>{property.address}</small></div></div>
        <div><button className="secondary-button" onClick={useCurrentLocation} disabled={saving}><Navigation size={16}/>Mi ubicación</button><a className="primary-button" href={mapsHref} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Abrir en Google Maps</a></div>
      </div>
    </article>

    <article className="card property-section">
      <div className="section-title"><div><p className="eyebrow">DOMICILIO PERMANENTE</p><h3>Información general</h3></div></div>
      <div className="form-grid property-form">
        <label>Nombre de la propiedad<input value={property.name} onChange={e=>setProperty({...property,name:e.target.value})}/></label>
        <label>Dirección completa<input value={property.address} onChange={e=>setProperty({...property,address:e.target.value})}/></label>
        <label className="wide">Referencias para llegar<textarea value={property.references} onChange={e=>setProperty({...property,references:e.target.value})} placeholder="Color de fachada, entre calles, punto de referencia..."/></label>
        <label>Colonia<input value={property.neighborhood} onChange={e=>setProperty({...property,neighborhood:e.target.value})}/></label>
        <label>Ciudad<input value={property.city} onChange={e=>setProperty({...property,city:e.target.value})}/></label>
        <label>Código Postal<input value={property.postalCode} onChange={e=>setProperty({...property,postalCode:e.target.value})}/></label>
        <label>Latitud / longitud<div className="coordinate-fields"><input value={property.latitude} onChange={e=>setProperty({...property,latitude:e.target.value})} placeholder="32.5149"/><input value={property.longitude} onChange={e=>setProperty({...property,longitude:e.target.value})} placeholder="-117.0382"/></div></label>
        <label className="wide">Enlace de Google Maps<input value={property.mapsUrl} onChange={e=>parseMapsLink(e.target.value)} placeholder="Pega aquí el enlace compartido desde Google Maps"/></label>
      </div>
    </article>

    <article className="card property-section">
      <div className="section-title"><div><p className="eyebrow">EVIDENCIA DEL DOMICILIO</p><h3>Fotografías permanentes</h3></div><span>{photos.length} imágenes</span></div>
      <div className="photo-controls"><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select><input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Descripción de las fotografías"/><button className="secondary-button" disabled={uploading} onClick={()=>cameraRef.current?.click()}><Camera size={16}/>Tomar foto</button><button className="primary-button" disabled={uploading} onClick={()=>fileRef.current?.click()}><Upload size={16}/>{uploading ? "Subiendo..." : "Subir imágenes"}</button></div>
      <input ref={cameraRef} className="hidden-file" type="file" accept="image/*" capture="environment" onChange={e=>uploadFiles(e.target.files)}/><input ref={fileRef} className="hidden-file" type="file" accept="image/*" multiple onChange={e=>uploadFiles(e.target.files)}/>
      {pendingPhotos.length > 0 && <div className="property-gallery pending-gallery" aria-live="polite">{pendingPhotos.map(photo=><article key={photo.previewUrl}><div className="photo-preview"><img src={photo.previewUrl} alt={`Vista previa de ${photo.file.name}`}/><span>Vista previa</span></div><div><strong>{photo.file.name}</strong><small>Preparando carga...</small></div></article>)}</div>}
      {photos.length ? <div className="property-gallery">{photos.map(photo=><article key={photo.id}><button className="photo-preview" onClick={()=>setLightbox(photo)}><img src={`/api/property-photos?id=${photo.id}`} alt={`${photo.category}: ${photo.description || "Fotografía de propiedad"}`}/><span>{photo.category}</span></button><div><strong>{photo.description || "Sin descripción"}</strong><small>{new Date(photo.created_at).toLocaleDateString("es-MX")} · {photo.user_name}</small></div><button className="delete-photo" onClick={()=>removePhoto(photo.id)} aria-label="Eliminar fotografía"><Trash2 size={15}/></button></article>)}</div> : <div className="photo-empty"><ImagePlus/><strong>{loading ? "Cargando galería..." : "Aún no hay fotografías"}</strong><p>Toma una foto de la fachada o sube varias imágenes.</p></div>}
    </article>

    <div className="property-bottom-grid">
      <article className="card property-section"><div className="section-title"><div><p className="eyebrow">INFORMACIÓN PARA EL TÉCNICO</p><h3>Notas permanentes</h3></div><ShieldAlert/></div><textarea className="notes-area" value={property.notes} onChange={e=>setProperty({...property,notes:e.target.value})} placeholder={"Código del portón\nMascotas\nEstacionamiento\nHorarios permitidos\nRiesgos\nMaterial instalado\nRecomendaciones futuras"}/></article>
      <article className="card property-section"><div className="section-title"><div><p className="eyebrow">TRABAJOS REALIZADOS</p><h3>Historial de servicios</h3></div><span>{history.length}</span></div><div className="property-history">{history.length ? history.map(service=><div key={service.id}><span><strong>{service.type}</strong><small>{service.date} · {service.technician}</small></span><span className="badge badge-gray">{service.status}</span><button onClick={()=>notify(`Orden ${service.folio} abierta`)}>Abrir orden</button></div>) : <p className="empty-property-history">No hay servicios registrados en esta propiedad.</p>}</div></article>
    </div>
    <div className="property-agenda-tip"><div className="map-pin"><MessageCircle/></div><div><strong>Información disponible en Agenda</strong><p>Al programar el próximo servicio se mostrará la fachada, Google Maps, WhatsApp y las notas importantes de esta propiedad.</p></div></div>
    {lightbox && <div className="photo-lightbox" onClick={()=>setLightbox(null)}><button aria-label="Cerrar"><X/></button><img src={`/api/property-photos?id=${lightbox.id}`} alt={lightbox.description || lightbox.category}/><div><strong>{lightbox.category}</strong><span>{lightbox.description}</span></div></div>}
  </section>;
}
