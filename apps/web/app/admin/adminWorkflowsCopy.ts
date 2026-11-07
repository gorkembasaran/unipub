import type { Locale } from "../i18n/config";

type WorkflowLink = {
  href: string;
  label: string;
  description: string;
};

export type AdminWorkflowsCopy = {
  nav: {
    merge: WorkflowLink;
    sourceProfiles: WorkflowLink;
    publications: WorkflowLink;
  };
  common: {
    topbarSubtitle: string;
    backToAdmin: string;
    loadingSession: string;
    unauthorizedTitle: string;
    unauthorizedBody: string;
    forbiddenTitle: string;
    searchTitle: string;
    searchSubtitle: string;
    searchPlaceholder: string;
    searchAction: string;
    searchActionLoading: string;
    searchHint: string;
    searchEmpty: string;
    unknownInstitution: string;
    unknownUser: string;
    noSelection: string;
    records: string;
    selected: string;
    sourceAuthor: string;
    targetAuthor: string;
    primaryAuthor: string;
    secondaryAuthor: string;
    sourceProfiles: string;
    publications: string;
    aliases: string;
    conflicts: string;
    selectedProfiles: string;
    selectedPublications: string;
    newAuthor: string;
    chooseExistingAuthor: string;
    reviewAction: string;
    cancelAction: string;
    confirmAction: string;
    openProfile: string;
  };
  dashboard: {
    title: string;
    subtitle: string;
    cards: {
      merge: {
        title: string;
        description: string;
        cta: string;
      };
      sourceProfiles: {
        title: string;
        description: string;
        cta: string;
      };
      publications: {
        title: string;
        description: string;
        cta: string;
      };
    };
  };
  merge: {
    metaTitle: string;
    metaDescription: string;
    heroEyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    verifiedTitle: string;
    verifiedBody: string;
    assignPrimary: string;
    assignSecondary: string;
    compareTitle: string;
    compareSubtitle: string;
    compareFlowLabel: string;
    reviewTitle: string;
    reviewSubtitle: string;
    reviewHintIdle: string;
    reviewHintReady: string;
    primarySummary: string;
    secondarySummary: string;
    confirmLabel: string;
    confirmLoading: string;
    success: string;
    failed: string;
  };
  sourceProfiles: {
    metaTitle: string;
    metaDescription: string;
    heroEyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    verifiedTitle: string;
    verifiedBody: string;
    modeDetach: string;
    modeRemove: string;
    sourceSummaryTitle: string;
    sourceSummarySubtitle: string;
    targetSearchTitle: string;
    targetSearchSubtitle: string;
    targetSearchPlaceholder: string;
    targetSearchEmpty: string;
    selectedProfilesTitle: string;
    selectedProfilesSubtitle: string;
    selectedPublicationsTitle: string;
    selectedPublicationsSubtitle: string;
    sourceProfilesEmpty: string;
    publicationsEmpty: string;
    detachTargetModeNew: string;
    detachTargetModeExisting: string;
    detachNewAuthorLabel: string;
    detachExistingLabel: string;
    detachExistingPlaceholder: string;
    detachReviewTitle: string;
    detachReviewSubtitle: string;
    reviewHintDetachReady: string;
    reviewHintRemoveReady: string;
    reviewNeedsSource: string;
    reviewNeedsProfiles: string;
    reviewNeedsNewAuthor: string;
    reviewNeedsTarget: string;
    detachConfirm: string;
    detachConfirmLoading: string;
    detachSuccess: string;
    detachFailed: string;
    removeReviewTitle: string;
    removeReviewSubtitle: string;
    removeConfirm: string;
    removeConfirmLoading: string;
    removeSuccess: string;
    removePublicationSuffix: string;
    removeFailed: string;
  };
  publications: {
    metaTitle: string;
    metaDescription: string;
    heroEyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    verifiedTitle: string;
    verifiedBody: string;
    sourceSummaryTitle: string;
    targetSearchTitle: string;
    targetSearchSubtitle: string;
    targetSearchPlaceholder: string;
    targetSearchEmpty: string;
    selectedPublicationsTitle: string;
    selectedPublicationsSubtitle: string;
    publicationsEmpty: string;
    reviewTitle: string;
    reviewSubtitle: string;
    confirm: string;
    confirmLoading: string;
    success: string;
    failed: string;
  };
};

const en: AdminWorkflowsCopy = {
  nav: {
    merge: { href: "/admin/merge", label: "Merge", description: "Combine duplicate author records" },
    sourceProfiles: {
      href: "/admin/source-profiles",
      label: "Source Profiles",
      description: "Detach or remove ownership safely",
    },
    publications: {
      href: "/admin/publications",
      label: "Publications",
      description: "Move publication ownership with clarity",
    },
  },
  common: {
    topbarSubtitle: "Guided operation workspace",
    backToAdmin: "Back to author workspace",
    loadingSession: "Checking the admin session...",
    unauthorizedTitle: "An admin session is required.",
    unauthorizedBody: "You are being redirected to the author workspace sign-in screen.",
    forbiddenTitle: "This account cannot access admin workflows.",
    searchTitle: "Find author records",
    searchSubtitle:
      "Search once, inspect the result list, and assign each record to a clear role before running any action.",
    searchPlaceholder: "Search an author name...",
    searchAction: "Search",
    searchActionLoading: "Searching...",
    searchHint: "Use at least 2 characters to start the search.",
    searchEmpty: "Matching author records will appear here after you search.",
    unknownInstitution: "Institution not available",
    unknownUser: "Unknown user",
    noSelection: "No selection",
    records: "{count} records",
    selected: "Selected",
    sourceAuthor: "Source author",
    targetAuthor: "Target author",
    primaryAuthor: "Primary author",
    secondaryAuthor: "Secondary author",
    sourceProfiles: "Source profiles",
    publications: "Publications",
    aliases: "Aliases",
    conflicts: "Conflicts",
    selectedProfiles: "Selected profiles",
    selectedPublications: "Selected publications",
    newAuthor: "New author",
    chooseExistingAuthor: "Choose existing author",
    reviewAction: "Review action",
    cancelAction: "Cancel",
    confirmAction: "Confirm",
    openProfile: "Open profile",
  },
  dashboard: {
    title: "Operation center",
    subtitle:
      "Open one focused workflow at a time. Each screen makes source, target, and affected profiles easier to read before you confirm.",
    cards: {
      merge: {
        title: "Merge authors",
        description: "Choose the kept record, the merged record, and review the direction before confirming.",
        cta: "Open merge workflow",
      },
      sourceProfiles: {
        title: "Detach or remove source profiles",
        description: "See exactly which provider profiles move away or get removed from the current author.",
        cta: "Open source profile workflow",
      },
      publications: {
        title: "Move publications",
        description: "Inspect publication ownership clearly before reassigning records to another author.",
        cta: "Open publication workflow",
      },
    },
  },
  merge: {
    metaTitle: "Admin Merge Workflow",
    metaDescription: "Compare author records and merge them with clearer source and target previews.",
    heroEyebrow: "Merge Workflow",
    heroTitle: "One kept record, one merged record",
    heroSubtitle:
      "Assign a primary record and a secondary record, compare them side by side, then confirm the merge in a dedicated review modal.",
    verifiedTitle: "Merge workflow ready",
    verifiedBody: "Search candidate records, assign roles, compare what stays and what gets folded in.",
    assignPrimary: "Keep this as primary",
    assignSecondary: "Merge this into primary",
    compareTitle: "Comparison board",
    compareSubtitle: "Review both author cards before opening the final confirmation.",
    compareFlowLabel: "Merge direction",
    reviewTitle: "Merge confirmation",
    reviewSubtitle:
      "The secondary record will be folded into the primary record. Publication ownership will follow the primary record.",
    reviewHintIdle: "Choose one primary author and one secondary author to unlock the review step.",
    reviewHintReady: "Roles are set. Review the cards once more before running the merge.",
    primarySummary: "Primary record stays active",
    secondarySummary: "Secondary record will be merged in",
    confirmLabel: "Run merge",
    confirmLoading: "Merging...",
    success: "{name} now contains the merged record. {count} publications were moved.",
    failed: "Merge operation failed.",
  },
  sourceProfiles: {
    metaTitle: "Admin Source Profile Workflow",
    metaDescription: "Detach or remove source profile ownership from a guided admin workflow.",
    heroEyebrow: "Source Profile Workflow",
    heroTitle: "Move or remove provider ownership with less ambiguity",
    heroSubtitle:
      "Choose one source author, mark the exact provider profiles involved, and review whether they move elsewhere or get removed.",
    verifiedTitle: "Source profile workflow ready",
    verifiedBody: "Selections stay visible while you define destination, publication impact, and final confirmation.",
    modeDetach: "Detach profiles",
    modeRemove: "Remove profiles",
    sourceSummaryTitle: "Current source author",
    sourceSummarySubtitle: "Profiles and publications attached to this record",
    targetSearchTitle: "Find target author",
    targetSearchSubtitle: "Use this only when moving selected source profiles to an existing author.",
    targetSearchPlaceholder: "Search target author...",
    targetSearchEmpty: "Target author candidates will appear here after you search.",
    selectedProfilesTitle: "Selected source profiles",
    selectedProfilesSubtitle: "These provider records are affected by the action.",
    selectedPublicationsTitle: "Selected publications",
    selectedPublicationsSubtitle: "These records move or lose source links together with the source profile action.",
    sourceProfilesEmpty: "No source profile is attached to the selected author.",
    publicationsEmpty: "No publication is attached to the selected author.",
    detachTargetModeNew: "Create a new author",
    detachTargetModeExisting: "Move to an existing author",
    detachNewAuthorLabel: "New author name",
    detachExistingLabel: "Existing target author",
    detachExistingPlaceholder: "Select a target author",
    detachReviewTitle: "Detach confirmation",
    detachReviewSubtitle:
      "Selected source profiles will leave the source author and move to the chosen destination together with any selected publications.",
    reviewHintDetachReady: "Selections are ready. Open the review step to confirm where these profiles will move.",
    reviewHintRemoveReady: "Selections are ready. Open the review step to confirm which profiles will be removed.",
    reviewNeedsSource: "Choose a source author first.",
    reviewNeedsProfiles: "Select at least one source profile to continue.",
    reviewNeedsNewAuthor: "Enter a new author name or switch to an existing target author.",
    reviewNeedsTarget: "Pick a target author before detaching the selected profiles.",
    detachConfirm: "Detach selected profiles",
    detachConfirmLoading: "Detaching...",
    detachSuccess: "{count} source profiles detached. {moved} publications were moved.",
    detachFailed: "Source-profile detach failed.",
    removeReviewTitle: "Removal confirmation",
    removeReviewSubtitle:
      "Selected source profiles will be removed from the source author. Selected publications will also lose this author link.",
    removeConfirm: "Remove selected profiles",
    removeConfirmLoading: "Removing...",
    removeSuccess: "{count} source profiles removed.{suffix}",
    removePublicationSuffix: " {count} selected publications also lost this author link.",
    removeFailed: "Source-profile removal failed.",
  },
  publications: {
    metaTitle: "Admin Publication Move Workflow",
    metaDescription: "Move publication ownership between authors from a clearer admin workflow.",
    heroEyebrow: "Publication Workflow",
    heroTitle: "Show exactly which publications move where",
    heroSubtitle:
      "Pick the source author, choose affected publications, define a target author, and confirm the transfer in one review step.",
    verifiedTitle: "Publication workflow ready",
    verifiedBody: "Source, target, and selected publication lists stay visible throughout the transfer flow.",
    sourceSummaryTitle: "Publication source author",
    targetSearchTitle: "Find publication target",
    targetSearchSubtitle: "The target author will receive every selected publication.",
    targetSearchPlaceholder: "Search target author...",
    targetSearchEmpty: "Target author candidates will appear here after you search.",
    selectedPublicationsTitle: "Selected publications",
    selectedPublicationsSubtitle: "These publication records will move from source to target.",
    publicationsEmpty: "No publication is attached to the selected author.",
    reviewTitle: "Publication move confirmation",
    reviewSubtitle: "Selected publications will be reassigned from the source author to the target author.",
    confirm: "Move selected publications",
    confirmLoading: "Moving...",
    success: "{count} publications moved to the target author.",
    failed: "Publication move failed.",
  },
};

const tr: AdminWorkflowsCopy = {
  nav: {
    merge: { href: "/admin/merge", label: "Merge", description: "Mükerrer yazar kayıtlarını birleştir" },
    sourceProfiles: {
      href: "/admin/source-profiles",
      label: "Kaynak Profiller",
      description: "Ayırma ve kaldırma işlemlerini net yönet",
    },
    publications: {
      href: "/admin/publications",
      label: "Yayınlar",
      description: "Yayın sahipliğini daha anlaşılır taşı",
    },
  },
  common: {
    topbarSubtitle: "Rehberli işlem çalışma alanı",
    backToAdmin: "Yazar çalışma alanına dön",
    loadingSession: "Admin oturumu kontrol ediliyor...",
    unauthorizedTitle: "Admin oturumu gerekli.",
    unauthorizedBody: "Yazar çalışma alanı giriş ekranına yönlendiriliyorsunuz.",
    forbiddenTitle: "Bu hesap admin workflow ekranlarına erişemiyor.",
    searchTitle: "Yazar kayıtlarını bulun",
    searchSubtitle:
      "Bir kez arayın, sonuç listesini inceleyin ve herhangi bir işlem çalıştırmadan önce her kayda net bir rol verin.",
    searchPlaceholder: "Yazar adı ara...",
    searchAction: "Ara",
    searchActionLoading: "Aranıyor...",
    searchHint: "Aramayı başlatmak için en az 2 karakter kullanın.",
    searchEmpty: "Arama yaptıktan sonra eşleşen yazar kayıtları burada görünecek.",
    unknownInstitution: "Kurum bilgisi yok",
    unknownUser: "Bilinmeyen kullanıcı",
    noSelection: "Seçim yok",
    records: "{count} kayıt",
    selected: "Seçili",
    sourceAuthor: "Kaynak yazar",
    targetAuthor: "Hedef yazar",
    primaryAuthor: "Ana yazar",
    secondaryAuthor: "Birleşecek yazar",
    sourceProfiles: "Kaynak profiller",
    publications: "Yayınlar",
    aliases: "Aliaslar",
    conflicts: "Çakışmalar",
    selectedProfiles: "Seçili profiller",
    selectedPublications: "Seçili yayınlar",
    newAuthor: "Yeni yazar",
    chooseExistingAuthor: "Var olan yazarı seç",
    reviewAction: "İşlemi incele",
    cancelAction: "Vazgeç",
    confirmAction: "Onayla",
    openProfile: "Profili aç",
  },
  dashboard: {
    title: "İşlem merkezi",
    subtitle:
      "Her seferinde tek bir odaklı workflow açın. Her ekran, onay vermeden önce kaynak, hedef ve etkilenen profilleri daha okunur gösterir.",
    cards: {
      merge: {
        title: "Yazar birleştir",
        description: "Kalacak kaydı ve birleşecek kaydı seçin, yönü net görün ve sonra onaylayın.",
        cta: "Merge workflow'unu aç",
      },
      sourceProfiles: {
        title: "Kaynak profil ayır veya kaldır",
        description: "Hangi provider profillerinin taşındığını veya kaldırıldığını açık biçimde görün.",
        cta: "Kaynak profil workflow'unu aç",
      },
      publications: {
        title: "Yayın taşı",
        description: "Yayın sahipliğini başka bir yazara aktarmadan önce kayıtları net şekilde inceleyin.",
        cta: "Yayın workflow'unu aç",
      },
    },
  },
  merge: {
    metaTitle: "Admin Merge Workflow",
    metaDescription: "Yazar kayıtlarını karşılaştırın ve birleştirme yönünü daha açık bir arayüzle yönetin.",
    heroEyebrow: "Merge Workflow",
    heroTitle: "Bir kayıt kalır, diğeri içine alınır",
    heroSubtitle:
      "Ana kaydı ve birleşecek kaydı ayrı ayrı atayın, yan yana karşılaştırın ve son onayı ayrı modal içinde verin.",
    verifiedTitle: "Merge workflow hazır",
    verifiedBody: "Aday kayıtları arayın, rolleri atayın ve hangisinin kaldığını net görerek birleştirin.",
    assignPrimary: "Bunu ana kayıt yap",
    assignSecondary: "Bunu ana kayda birleştir",
    compareTitle: "Karşılaştırma panosu",
    compareSubtitle: "Final onayı açmadan önce iki yazarı yan yana inceleyin.",
    compareFlowLabel: "Birleştirme yönü",
    reviewTitle: "Merge onayı",
    reviewSubtitle:
      "İkinci kayıt ana kaydın içine alınacak. Yayın sahipliği ana kayıtta toplanacak.",
    reviewHintIdle: "İnceleme adımını açmak için bir ana kayıt ve bir birleşecek kayıt seçin.",
    reviewHintReady: "Roller hazır. Merge işleminden önce kartları son kez kontrol edin.",
    primarySummary: "Ana kayıt aktif kalır",
    secondarySummary: "İkinci kayıt ana kaydın içine alınır",
    confirmLabel: "Merge işlemini çalıştır",
    confirmLoading: "Birleştiriliyor...",
    success: "{name} kaydı içinde birleştirme tamamlandı. {count} yayın taşındı.",
    failed: "Merge işlemi başarısız oldu.",
  },
  sourceProfiles: {
    metaTitle: "Admin Kaynak Profil Workflow",
    metaDescription: "Kaynak profil sahipliğini ayırma veya kaldırma işlemlerini rehberli admin akışıyla yönetin.",
    heroEyebrow: "Kaynak Profil Workflow",
    heroTitle: "Provider sahipliğini daha az belirsizlikle yönetin",
    heroSubtitle:
      "Tek bir kaynak yazarı seçin, etkilenen provider profillerini işaretleyin ve bu kayıtların taşınıp taşınmadığını veya kaldırılıp kaldırılmadığını net görün.",
    verifiedTitle: "Kaynak profil workflow hazır",
    verifiedBody: "Seçimler görünür kalırken hedefi, yayın etkisini ve son onayı ayrı ayrı tanımlayabilirsiniz.",
    modeDetach: "Profilleri ayır",
    modeRemove: "Profilleri kaldır",
    sourceSummaryTitle: "Geçerli kaynak yazar",
    sourceSummarySubtitle: "Bu kayda bağlı profiller ve yayınlar",
    targetSearchTitle: "Hedef yazar bulun",
    targetSearchSubtitle: "Bunu yalnızca seçili kaynak profilleri var olan bir yazara taşınacaksa kullanın.",
    targetSearchPlaceholder: "Hedef yazar ara...",
    targetSearchEmpty: "Aradıktan sonra hedef yazar adayları burada görünecek.",
    selectedProfilesTitle: "Seçili kaynak profiller",
    selectedProfilesSubtitle: "Bu provider kayıtları işlemden etkilenecek.",
    selectedPublicationsTitle: "Seçili yayınlar",
    selectedPublicationsSubtitle: "Bu kayıtlar kaynak profil işlemiyle birlikte taşınır veya yazar bağını kaybeder.",
    sourceProfilesEmpty: "Seçili yazara bağlı kaynak profil yok.",
    publicationsEmpty: "Seçili yazara bağlı yayın yok.",
    detachTargetModeNew: "Yeni yazar oluştur",
    detachTargetModeExisting: "Var olan yazara taşı",
    detachNewAuthorLabel: "Yeni yazar adı",
    detachExistingLabel: "Var olan hedef yazar",
    detachExistingPlaceholder: "Hedef yazar seçin",
    detachReviewTitle: "Ayırma onayı",
    detachReviewSubtitle:
      "Seçili kaynak profiller kaynak yazardan ayrılacak ve seçilen yayınlarla birlikte hedefe taşınacak.",
    reviewHintDetachReady: "Seçimler hazır. Bu profillerin nereye taşınacağını onaylamak için inceleme adımını açın.",
    reviewHintRemoveReady: "Seçimler hazır. Hangi profillerin kaldırılacağını onaylamak için inceleme adımını açın.",
    reviewNeedsSource: "Önce kaynak yazarı seçin.",
    reviewNeedsProfiles: "Devam etmek için en az bir kaynak profil seçin.",
    reviewNeedsNewAuthor: "Yeni yazar adı girin ya da var olan bir hedef yazar seçin.",
    reviewNeedsTarget: "Seçili profilleri ayırmadan önce hedef yazarı seçin.",
    detachConfirm: "Seçili profilleri ayır",
    detachConfirmLoading: "Ayrılıyor...",
    detachSuccess: "{count} kaynak profil ayrıldı. {moved} yayın taşındı.",
    detachFailed: "Kaynak profil ayırma işlemi başarısız oldu.",
    removeReviewTitle: "Kaldırma onayı",
    removeReviewSubtitle:
      "Seçili kaynak profiller kaynak yazardan kaldırılacak. Seçili yayınlar da bu yazar bağını kaybedecek.",
    removeConfirm: "Seçili profilleri kaldır",
    removeConfirmLoading: "Kaldırılıyor...",
    removeSuccess: "{count} kaynak profil silindi.{suffix}",
    removePublicationSuffix: " {count} seçili yayın da bu yazar bağını kaybetti.",
    removeFailed: "Kaynak profil kaldırma işlemi başarısız oldu.",
  },
  publications: {
    metaTitle: "Admin Yayın Taşıma Workflow",
    metaDescription: "Yayın sahipliğini yazarlar arasında daha anlaşılır bir admin akışıyla taşıyın.",
    heroEyebrow: "Yayın Workflow",
    heroTitle: "Hangi yayın nereye gidiyor açıkça gösterin",
    heroSubtitle:
      "Kaynak yazarı seçin, etkilenen yayınları işaretleyin, hedef yazarı tanımlayın ve transferi tek bir inceleme adımında onaylayın.",
    verifiedTitle: "Yayın workflow hazır",
    verifiedBody: "Kaynak, hedef ve seçili yayın listeleri transfer boyunca görünür kalır.",
    sourceSummaryTitle: "Yayın kaynak yazarı",
    targetSearchTitle: "Yayın hedefini bulun",
    targetSearchSubtitle: "Hedef yazar seçilen tüm yayınları devralacak.",
    targetSearchPlaceholder: "Hedef yazar ara...",
    targetSearchEmpty: "Aradıktan sonra hedef yazar adayları burada görünecek.",
    selectedPublicationsTitle: "Seçili yayınlar",
    selectedPublicationsSubtitle: "Bu yayın kayıtları kaynaktan hedefe taşınacak.",
    publicationsEmpty: "Seçili yazara bağlı yayın yok.",
    reviewTitle: "Yayın taşıma onayı",
    reviewSubtitle: "Seçili yayınlar kaynak yazardan alınıp hedef yazara bağlanacak.",
    confirm: "Seçili yayınları taşı",
    confirmLoading: "Taşınıyor...",
    success: "{count} yayın hedef yazara taşındı.",
    failed: "Yayın taşıma işlemi başarısız oldu.",
  },
};

const workflowCopies: Record<"tr" | "en", AdminWorkflowsCopy> = {
  tr,
  en,
};

export function getAdminWorkflowsCopy(locale: string | Locale): AdminWorkflowsCopy {
  return workflowCopies[String(locale).toLowerCase().startsWith("tr") ? "tr" : "en"];
}

export function getAdminWorkflowLinks(locale: string | Locale): WorkflowLink[] {
  const copy = getAdminWorkflowsCopy(locale);
  return [copy.nav.merge, copy.nav.sourceProfiles, copy.nav.publications];
}
