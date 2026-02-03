# Preguntas frecuentes (FAQs)

## ¿Qué es Arche?

Arche es un sistema multiusuario que levanta instancias aisladas de OpenCode bajo demanda.

## ¿Cómo funciona el acceso por subdominios?

El acceso es por un único host por despliegue (por ejemplo, `dominio.com` o `sub.dominio.com`). Si quieres separar por empresa, usa un subdominio por empresa (por ejemplo, `arche.<empresa>.<dominio-principal>`). No usamos subdominios por usuario.

## ¿OpenCode está expuesto a Internet?

No. El navegador habla con Arche, y Arche proxya las llamadas necesarias hacia el runtime.

## ¿Qué necesito para usarlo?

Un dominio configurado con DNS y un entorno con Docker (ver documentación técnica del proyecto).

## ¿Hay planes o suscripción?

Todavía no hay un sistema de pagos/suscripciones definido. Esta sección se actualizará cuando exista un modelo de planes.
