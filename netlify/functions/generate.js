const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  const ENDPOINT = "https://ark.ap-southeast-1.bytepluses.com/api/v3/contents/generations/tasks";

  if (!BYTEPLUS_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API key not configured." }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { prompt, duration, mediaItems } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Prompt is required." }),
      };
    }

    // Upload media to Netlify Blobs and get public URLs
    const store = getStore({
      name: "smobflow-media",
      siteID: context.site?.id || process.env.SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN || context.clientContext?.identity?.token,
    });

    const mediaUrls = [];

    if (mediaItems && mediaItems.length > 0) {
      for (const item of mediaItems) {
        if (!item.dataUrl) continue;

        // Convert base64 to buffer
        const base64Data = item.dataUrl.split(",")[1];
        const buffer = Buffer.from(base64Data, "base64");
        const ext = item.type === "video" ? "mp4" : "jpg";
        const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        await store.set(key, buffer, {
          metadata: { type: item.mimeType || (item.type === "video" ? "video/mp4" : "image/jpeg") },
        });

        const url = `https://${process.env.URL || event.headers.host}/.netlify/blobs/smobflow-media/${key}`;
        mediaUrls.push({ type: item.type, url });
      }
    }

    // Build BytePlus content array
    const content = [{ type: "text", text: prompt }];

    for (const media of mediaUrls) {
      if (media.type === "image") {
        content.push({
          type: "image_url",
          image_url: { url: media.url },
          role: "reference_image",
        });
      } else if (media.type === "video") {
        content.push({
          type: "video_url",
          video_url: { url: media.url },
          role: "reference_video",
        });
      }
    }

    const payload = {
      model: "dreamina-seedance-2-0-260128",
      content,
      generate_audio: true,
      ratio: "9:16",
      duration: duration || 15,
      watermark: false,
    };

    // Submit task
    const submitRes = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BYTEPLUS_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      return {
        statusCode: submitRes.status,
        body: JSON.stringify({ error: submitData.message || submitData.error || JSON.stringify(submitData) }),
      };
    }

    const taskId =
      submitData?.data?.task_id ||
      submitData?.task_id ||
      submitData?.id;

    if (!taskId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No task ID returned.", raw: submitData }),
      };
    }

    // Poll for result
    const pollUrl = `${ENDPOINT}/${taskId}`;
    let videoUrl = null;

    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${BYTEPLUS_API_KEY}` },
      });

      const pollData = await pollRes.json();
      const status =
        pollData?.data?.status ||
        pollData?.status ||
        pollData?.data?.task_status;

      if (["succeeded", "completed", "Success", "success"].includes(status)) {
        videoUrl =
          pollData?.data?.video_url ||
          pollData?.data?.output?.video_url ||
          pollData?.data?.videos?.[0]?.url ||
          pollData?.video_url;
        break;
      }

      if (["failed", "Failed", "error"].includes(status)) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Video generation failed.", raw: pollData }),
        };
      }
    }

    if (!videoUrl) {
      return {
        statusCode: 504,
        body: JSON.stringify({ error: "Video generation timed out. Try again." }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_url: videoUrl }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
