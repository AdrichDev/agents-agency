import type { Metadata } from "next";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Política de Cookies · 3A Estudio",
  description: "Uso de cookies y almacenamiento local en la plataforma.",
};

export default function CookiesPage() {
  return (
    <>
      <h1>Política de Cookies</h1>
      <p className={styles.updated}>Última actualización: 13 de julio de 2026</p>

      <h2>Introducción</h2>
      <p>El sitio web y las áreas privadas de <strong>3A Estudio</strong> pueden utilizar cookies y tecnologías similares para permitir la navegación, mantener la seguridad, facilitar el acceso a determinadas funciones y recordar las preferencias de las personas usuarias.</p>
      <p>Esta política explica de forma clara qué son las cookies, qué tipos existen, cuáles pueden utilizarse y cómo pueden configurarse o eliminarse.</p>

      <h2>1. Responsable</h2>
      <ul>
        <li><strong>Titular:</strong> Adrián Chozas Vinuesa</li>
        <li><strong>Nombre comercial:</strong> 3A Estudio</li>
        <li><strong>NIF:</strong> 52886814-Q</li>
        <li><strong>Domicilio:</strong> Calle Aquiles, 25, 4.º H, Madrid, España</li>
        <li><strong>Correo electrónico:</strong> achozas9@gmail.com</li>
        <li><strong>Sitio web:</strong> https://3aestudio.vercel.app/</li>
      </ul>

      <h2>2. Qué son las cookies</h2>
      <p>Las cookies son pequeños archivos que se almacenan en el navegador o dispositivo cuando se visita una página web. Sirven, entre otras funciones, para mantener una sesión iniciada, recordar preferencias, proteger zonas restringidas o conocer cómo se utiliza un sitio.</p>
      <p>Las cookies no dañan por sí mismas el dispositivo, aunque algunas pueden permitir identificar o diferenciar a una persona usuaria y, por ello, están sujetas a las obligaciones legales de información y consentimiento.</p>

      <h2>3. Tipos de cookies</h2>
      <p>Según quién las gestione, pueden ser:</p>
      <ul>
        <li><strong>Propias:</strong> gestionadas desde el dominio de 3A Estudio.</li>
        <li><strong>De terceros:</strong> gestionadas por proveedores o servicios externos.</li>
      </ul>
      <p>Según su duración, pueden ser:</p>
      <ul>
        <li><strong>De sesión:</strong> desaparecen al cerrar el navegador o finalizar la sesión.</li>
        <li><strong>Persistentes:</strong> permanecen almacenadas durante un periodo determinado.</li>
      </ul>
      <p>Según su finalidad, pueden ser:</p>
      <ul>
        <li><strong>Técnicas o necesarias:</strong> permiten la navegación, la autenticación, la seguridad y el funcionamiento básico del sitio.</li>
        <li><strong>De preferencias:</strong> recuerdan determinadas elecciones de la persona usuaria.</li>
        <li><strong>De análisis:</strong> permiten obtener estadísticas sobre el uso del sitio.</li>
        <li><strong>Publicitarias o de publicidad comportamental:</strong> permiten gestionar anuncios o crear perfiles de navegación.</li>
      </ul>

      <h2>4. Cookies utilizadas</h2>
      <p>En su configuración actual, 3A Estudio utiliza principalmente cookies o tecnologías <strong>técnicas y necesarias</strong> para:</p>
      <ul>
        <li>Mantener la sesión iniciada en áreas privadas.</li>
        <li>Identificar de forma segura a la persona usuaria.</li>
        <li>Proteger cuentas y formularios frente a usos indebidos.</li>
        <li>Recordar determinadas preferencias o configuraciones del servicio.</li>
        <li>Permitir el funcionamiento de las herramientas contratadas.</li>
      </ul>
      <p>Estas tecnologías pueden utilizarse sin consentimiento previo cuando sean estrictamente necesarias para prestar el servicio solicitado.</p>
      <p>Actualmente no se declara el uso de cookies publicitarias ni de publicidad comportamental. Si se incorporan cookies de análisis, publicidad, redes sociales u otros servicios no necesarios, se actualizará esta política y se solicitará consentimiento antes de instalarlas.</p>

      <h2>5. Servicios de terceros</h2>
      <p>Al acceder a contenidos externos o conectar voluntariamente una integración, el proveedor correspondiente puede utilizar cookies en sus propios dominios. Esto puede ocurrir, por ejemplo, en procesos de identificación externa o al conectar calendarios, correo electrónico, mapas, vídeos o redes sociales.</p>
      <p>
        Estas cookies se regirán por las políticas del tercero correspondiente. Cuando se instalen desde el sitio de 3A Estudio y no sean necesarias, se solicitará el consentimiento de la persona usuaria. En cualquier caso, si el usuario conecta su cuenta de Google, la autenticación se realiza en los dominios de Google, sujeta a la{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">política de privacidad de Google</a>.
      </p>

      <h2>6. Consentimiento y configuración</h2>
      <p>Las cookies técnicas estrictamente necesarias no requieren consentimiento. Las demás no se instalarán hasta que la persona usuaria las acepte mediante el mecanismo habilitado.</p>
      <p>Cuando exista un panel de configuración, se podrá aceptar, rechazar o seleccionar las categorías deseadas, así como modificar o retirar posteriormente el consentimiento.</p>
      <p>La persona usuaria también puede bloquear o eliminar las cookies desde la configuración de su navegador. La desactivación de las cookies técnicas puede provocar que algunas funciones, áreas privadas o sesiones no funcionen correctamente.</p>

      <h2>7. Datos personales y derechos</h2>
      <p>Cuando la información obtenida mediante cookies permita identificar a una persona, su tratamiento se regirá también por la <strong>Política de Privacidad</strong>.</p>
      <p>
        Para realizar consultas o ejercer los derechos reconocidos por la normativa puede escribir a <strong>achozas9@gmail.com</strong>. También puede presentar una reclamación ante la Agencia Española de Protección de Datos a través de{" "}
        <a href="https://www.aepd.es/" target="_blank" rel="noopener noreferrer">https://www.aepd.es/</a>.
      </p>

      <h2>8. Modificaciones</h2>
      <p>3A Estudio podrá modificar esta política cuando cambien las cookies utilizadas, se incorporen nuevos servicios o resulte necesario adaptarla a cambios legales o técnicos.</p>
      <p>La versión vigente será la publicada en el sitio web con su fecha de última actualización.</p>
    </>
  );
}
