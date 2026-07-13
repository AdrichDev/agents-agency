import type { Metadata } from "next";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Política de Privacidad · 3A Estudio",
  description: "Cómo tratamos los datos personales en la plataforma.",
};

export default function PrivacidadPage() {
  return (
    <>
      <h1>Política de Privacidad</h1>
      <p className={styles.updated}>Última actualización: 13 de julio de 2026</p>

      <h2>Introducción</h2>
      <p>En <strong>3A Estudio</strong> respetamos la privacidad de las personas usuarias y tratamos sus datos personales de forma lícita, leal, transparente y confidencial.</p>
      <p>Cuando necesitemos información personal, la solicitaremos de manera adecuada y únicamente para finalidades determinadas. Esta política explica quién es el responsable, qué datos se tratan, para qué se utilizan, durante cuánto tiempo se conservan y cómo pueden ejercerse los derechos reconocidos por la normativa.</p>
      <p>El tratamiento se realizará conforme al Reglamento (UE) 2016/679, la Ley Orgánica 3/2018 y demás normativa aplicable en materia de protección de datos.</p>

      <h2>1. Responsable del tratamiento</h2>
      <ul>
        <li><strong>Titular:</strong> Adrián Chozas Vinuesa</li>
        <li><strong>Nombre comercial:</strong> 3A Estudio</li>
        <li><strong>NIF:</strong> 52886814-Q</li>
        <li><strong>Domicilio:</strong> Calle Aquiles, 25, 4.º H, Madrid, España</li>
        <li><strong>Correo electrónico:</strong> achozas9@gmail.com</li>
        <li><strong>Teléfono:</strong> 635 984 010</li>
        <li><strong>Sitio web:</strong> https://3aestudio.vercel.app/</li>
      </ul>

      <h2>2. Datos que podemos tratar</h2>
      <p>Dependiendo de la relación con la persona usuaria, podrán tratarse las siguientes categorías de datos:</p>
      <ul>
        <li>Datos identificativos y de contacto, como nombre, apellidos, correo electrónico y teléfono.</li>
        <li>Datos facilitados mediante formularios, solicitudes de presupuesto o comunicaciones.</li>
        <li>Datos necesarios para gestionar una cuenta, una relación comercial o la prestación de un servicio.</li>
        <li>Datos de facturación y pago cuando exista contratación.</li>
        <li>Información técnica y de uso necesaria para la seguridad y funcionamiento del sitio.</li>
        <li>Datos vinculados a integraciones externas cuando la persona usuaria decida conectarlas voluntariamente.</li>
      </ul>
      <p>No se solicitarán datos innecesarios para las finalidades informadas.</p>

      <h2>3. Finalidades y bases jurídicas</h2>
      <p>Los datos podrán tratarse para:</p>
      <ul>
        <li>Atender consultas, solicitudes de información y presupuestos.</li>
        <li>Gestionar relaciones comerciales y prestar los servicios contratados.</li>
        <li>Crear y administrar cuentas de usuario y áreas privadas.</li>
        <li>Emitir facturas, gestionar cobros y cumplir obligaciones contables, fiscales o legales.</li>
        <li>Enviar comunicaciones relacionadas con el servicio.</li>
        <li>Remitir comunicaciones comerciales cuando exista consentimiento o una base legal válida.</li>
        <li>Proteger la seguridad del sitio, prevenir usos fraudulentos y resolver incidencias.</li>
        <li>Gestionar integraciones solicitadas por la persona usuaria.</li>
      </ul>
      <p>Las bases jurídicas serán, según cada caso, el consentimiento, la aplicación de medidas precontractuales, la ejecución de un contrato, el cumplimiento de obligaciones legales o el interés legítimo en mantener la seguridad y mejorar el servicio.</p>
      <p>La persona usuaria puede retirar su consentimiento en cualquier momento, sin que ello afecte a la licitud del tratamiento realizado anteriormente.</p>

      <h2>4. Datos introducidos por clientes en la plataforma</h2>
      <p>Cuando un cliente utilice las herramientas de 3A Estudio para gestionar datos de sus propios clientes, empleados, contactos o usuarios, dicho cliente será normalmente el <strong>responsable del tratamiento</strong>, al decidir para qué y cómo se utilizan esos datos.</p>
      <p>En esos casos, 3A Estudio actuará como <strong>encargado del tratamiento</strong> y tratará la información únicamente para prestar el servicio, siguiendo las instrucciones del cliente y las condiciones establecidas en el correspondiente contrato.</p>
      <p>El cliente será responsable de informar a las personas afectadas, disponer de una base jurídica válida y no introducir datos que no sean necesarios o que no esté autorizado a tratar.</p>

      <h2>5. Conservación de los datos</h2>
      <p>Los datos se conservarán durante el tiempo necesario para atender la solicitud o mantener la relación contractual o comercial.</p>
      <p>Cuando la relación finalice, se bloquearán o eliminarán, salvo que deban conservarse durante los plazos exigidos por obligaciones legales, fiscales, contables o por la posible formulación y defensa de reclamaciones.</p>
      <p>Los datos utilizados para comunicaciones comerciales se conservarán hasta que la persona interesada retire su consentimiento o se oponga al tratamiento.</p>

      <h2>6. Destinatarios y proveedores</h2>
      <p>Los datos no se venderán ni se comunicarán a terceros para fines propios ajenos a los aquí indicados.</p>
      <p>Podrán acceder a ellos proveedores necesarios para prestar el servicio, como servicios de alojamiento, bases de datos, autenticación, correo electrónico, soporte, facturación o integraciones externas. Estos proveedores actuarán bajo las garantías y contratos exigidos por la normativa.</p>
      <p>También podrán comunicarse datos a administraciones públicas, juzgados, tribunales u otras autoridades cuando exista una obligación legal.</p>
      <p>Algunos proveedores pueden estar situados fuera del Espacio Económico Europeo. En tal caso, se aplicarán las garantías reconocidas por la normativa, como decisiones de adecuación o cláusulas contractuales tipo.</p>

      <h2>7. Integraciones con servicios externos</h2>
      <p>Cuando la persona usuaria conecte voluntariamente servicios externos, como calendarios o correo electrónico, solo se accederá a la información necesaria para ejecutar las funciones solicitadas.</p>
      <p>La conexión podrá revocarse desde la configuración del servicio correspondiente. Los datos obtenidos mediante estas integraciones no se venderán ni se utilizarán con fines publicitarios ajenos a la prestación contratada.</p>
      <p>
        En el caso concreto de los servicios de Google, el uso de la información recibida de sus APIs se ajusta a la{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Política de Datos de Usuario de los Servicios de API de Google</a>,{" "}
        incluidos los requisitos de Uso Limitado (Limited Use): los datos se usan exclusivamente para las funciones solicitadas por la persona usuaria, no se transfieren a terceros ni se emplean con fines publicitarios.
      </p>

      <h2>8. Derechos de las personas interesadas</h2>
      <p>La persona interesada puede ejercer los siguientes derechos:</p>
      <ul>
        <li>Acceso a sus datos personales.</li>
        <li>Rectificación de datos inexactos o incompletos.</li>
        <li>Supresión cuando ya no sean necesarios o proceda legalmente.</li>
        <li>Oposición al tratamiento en determinadas circunstancias.</li>
        <li>Limitación del tratamiento.</li>
        <li>Portabilidad de los datos cuando resulte aplicable.</li>
        <li>Retirada del consentimiento en cualquier momento.</li>
      </ul>
      <p>Para ejercerlos puede escribir a <strong>achozas9@gmail.com</strong>, indicando su solicitud y aportando la información necesaria para verificar su identidad cuando sea preciso.</p>
      <p>Si los datos fueron incorporados por un cliente de 3A Estudio, la solicitud deberá dirigirse preferentemente a dicho cliente, al ser quien determina la finalidad del tratamiento.</p>
      <p>
        También puede presentar una reclamación ante la <strong>Agencia Española de Protección de Datos</strong> a través de{" "}
        <a href="https://www.aepd.es/" target="_blank" rel="noopener noreferrer">https://www.aepd.es/</a>.
      </p>

      <h2>9. Seguridad y confidencialidad</h2>
      <p>3A Estudio aplica medidas técnicas y organizativas adecuadas para proteger los datos frente a la pérdida, alteración, acceso o comunicación no autorizada. Las personas y proveedores que puedan acceder a información personal estarán sujetos a deberes de confidencialidad.</p>
      <p>No obstante, ningún sistema conectado a Internet puede garantizar una seguridad absoluta. En caso de incidente, se actuará conforme a las obligaciones previstas en la normativa.</p>

      <h2>10. Menores y modificaciones</h2>
      <p>Los servicios están dirigidos principalmente a profesionales, empresas y personas con capacidad legal para contratar. No se recabarán deliberadamente datos de menores sin las autorizaciones o garantías legalmente exigibles.</p>
      <p>3A Estudio podrá actualizar esta Política de Privacidad para adaptarla a cambios legales, técnicos o relacionados con los servicios. La versión vigente será la publicada en el sitio web con su fecha de actualización.</p>
    </>
  );
}
